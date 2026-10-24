import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const deploymentScript = readFileSync(new URL('./deploy.sh', import.meta.url))

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'lunch-deploy-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const source = join(root, 'runner checkout')
	const production = join(root, 'server checkout')
	const remote = join(root, 'origin.git')
	const git = (cwd, ...args) =>
		execFileSync('git', ['-C', cwd, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim()
	git(root, 'init', '--bare', '--initial-branch=main', remote)
	git(root, 'clone', '--config', 'core.autocrlf=false', remote, source)
	git(source, 'config', 'user.name', 'Deployment fixture')
	git(source, 'config', 'user.email', 'fixture@example.invalid')
	mkdirSync(join(source, 'scripts'))
	writeFileSync(join(source, 'scripts/deploy.sh'), deploymentScript)
	writeFileSync(join(source, '.gitignore'), '.env\n')
	writeFileSync(
		join(source, 'compose.yaml'),
		'name: lunch-roller\nservices: {}\n',
	)
	writeFileSync(join(source, 'release.txt'), 'initial\n')
	git(source, 'add', '.')
	git(source, 'commit', '-m', 'initial fixture')
	const initial = git(source, 'rev-parse', 'HEAD')
	git(source, 'push', 'origin', 'main')
	git(root, 'clone', '--config', 'core.autocrlf=false', remote, production)
	const configuration = 'TEST_FIXTURE=1\n'
	writeFileSync(join(production, '.env'), configuration)
	writeFileSync(join(source, 'release.txt'), 'tested release\n')
	git(source, 'add', 'release.txt')
	git(source, 'commit', '-m', 'tested fixture')
	const tested = git(source, 'rev-parse', 'HEAD')
	git(source, 'push', 'origin', 'main')

	const bin = join(root, 'bin')
	const log = join(root, 'docker-calls')
	mkdirSync(bin)
	writeFileSync(
		join(bin, 'docker'),
		'#!/bin/sh\nprintf "%s\\n" "$*" >> "$DEPLOY_TEST_LOG"\nif [ "$2" = up ]; then exit "${DEPLOY_TEST_EXIT:-0}"; fi\n',
		{ mode: 0o755 },
	)
	const run = (options = {}) =>
		spawnSync(
			'bash',
			[
				join(source, 'scripts/deploy.sh'),
				options.path ?? production,
				options.sha ?? tested,
			],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					DEPLOY_TEST_LOG: log,
					DEPLOY_TEST_EXIT: options.dockerExit ?? '0',
				},
			},
		)
	const calls = () => {
		try {
			return readFileSync(log, 'utf8')
		} catch {
			return ''
		}
	}
	return {
		source,
		production,
		initial,
		tested,
		git,
		configuration,
		run,
		calls,
	}
}

test('deploys the exact tested commit, preserves server configuration and waits for Compose health', (t) => {
	const f = fixture(t)
	const result = f.run()
	assert.equal(result.status, 0, result.stderr)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), f.tested)
	assert.equal(
		readFileSync(join(f.production, '.env'), 'utf8'),
		f.configuration,
	)
	assert.equal(
		readFileSync(join(f.production, 'release.txt'), 'utf8'),
		'tested release\n',
	)
	assert.match(f.calls(), /^compose up -d --build --wait --wait-timeout 300$/m)
})

test('refuses a dirty production checkout without discarding local edits', (t) => {
	const f = fixture(t)
	writeFileSync(join(f.production, 'release.txt'), 'local edit\n')
	const result = f.run()
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /local changes/)
	assert.equal(
		readFileSync(join(f.production, 'release.txt'), 'utf8'),
		'local edit\n',
	)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), f.initial)
	assert.doesNotMatch(f.calls(), /compose up/)
})

test('refuses a different server branch', (t) => {
	const f = fixture(t)
	f.git(f.production, 'checkout', '-b', 'server-work')
	const result = f.run()
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /already be on main/)
	assert.equal(f.git(f.production, 'branch', '--show-current'), 'server-work')
	assert.doesNotMatch(f.calls(), /compose up/)
})

test('refuses divergent server commits rather than resetting them', (t) => {
	const f = fixture(t)
	f.git(f.production, 'config', 'user.name', 'Server fixture')
	f.git(f.production, 'config', 'user.email', 'server@example.invalid')
	writeFileSync(join(f.production, 'server-only.txt'), 'keep this\n')
	f.git(f.production, 'add', 'server-only.txt')
	f.git(f.production, 'commit', '-m', 'local server commit')
	const serverCommit = f.git(f.production, 'rev-parse', 'HEAD')
	const result = f.run()
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /No reset was performed/)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), serverCommit)
	assert.doesNotMatch(f.calls(), /compose up/)
})

test('skips a queued older release without rolling the server back', (t) => {
	const f = fixture(t)
	assert.equal(f.run().status, 0)
	f.git(f.source, 'checkout', '--detach', f.initial)
	const result = f.run({ sha: f.initial })
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /Skipping older deployment/)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), f.tested)
	assert.equal(
		f
			.calls()
			.split('\n')
			.filter((line) => line.startsWith('compose up')).length,
		1,
	)
})

test('propagates a failed Compose deployment without attempting a database rollback', (t) => {
	const f = fixture(t)
	const result = f.run({ dockerExit: '17' })
	assert.equal(result.status, 17)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), f.tested)
	assert.equal(
		readFileSync(join(f.production, '.env'), 'utf8'),
		f.configuration,
	)
	assert.doesNotMatch(f.calls(), /compose down|--volumes/)
	assert.doesNotMatch(result.stdout, /Compose services are healthy/)
})

test('refuses a SHA different from the CI checkout', (t) => {
	const f = fixture(t)
	const result = f.run({ sha: f.initial })
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /does not match the tested commit/)
	assert.equal(f.git(f.production, 'rev-parse', 'HEAD'), f.initial)
	assert.doesNotMatch(f.calls(), /compose up/)
})

test('refuses deployment without the server configuration file', (t) => {
	const f = fixture(t)
	rmSync(join(f.production, '.env'))
	const result = f.run()
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /existing .env configuration/)
	assert.doesNotMatch(f.calls(), /compose up/)
})

test('refuses to deploy into the runner checkout', (t) => {
	const f = fixture(t)
	const result = f.run({ path: f.source })
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /outside the production checkout/)
	assert.doesNotMatch(f.calls(), /compose up/)
})
