'use client'

import type {
	AttendanceStatus,
	BettingWindow,
	CurrentInfluenceResponse,
	DrawSkip,
	EconomySettings,
	GamePreferences,
	HealthLevel,
	HealthRuleSettings,
	Participant,
	ParticipantRemoval,
	Place,
	Schedule,
	SetupStatus,
	TodayResponse,
	WalletResponse,
} from '@lunch/contracts'
import {
	currentInfluenceResponse,
	defaultEconomySettings,
	defaultGamePreferences,
	defaultHealthRuleSettings,
} from '@lunch/contracts'
import { scheduledInstant } from '@lunch/domain'
import Image from 'next/image'
import Link from 'next/link'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calendarDateLabel } from '../lib/date-label'
import { approximateOdds, weightInput } from '../lib/odds'
import {
	animationPlan,
	serverClockAnchor,
	spinIsLive,
} from '../lib/wheel-animation'
import { wheelColors, wheelSliceColor } from '../lib/wheel-colors'
import { CountdownBanner } from './countdown-banner'
import { DailyActivity, TokenOverview } from './daily-activity'
import { HealthBadge, HealthSelect } from './health-label'
import { InfluenceControls } from './influence-controls'
import { PlaceActionControls, PlaceNameControl } from './place-controls'
import { Readiness } from './readiness'
import { RulesHelp } from './rules-help'
import { TeamActivity } from './team-activity'
import { ThemeToggle } from './theme-toggle'
import {
	combineInfluenceEntries,
	TokenEntryDescription,
	WalletBets,
} from './token-history'
import { TokenTransfer } from './token-transfer'
import { useWheelAnimation } from './use-wheel-animation'
import { WinnerCelebration } from './winner-celebration'
import './countdown-banner.css'

type ApiError = { error?: { code?: string; message?: string } }
type TokenBalanceRow = { participantId: string; balance: number }
type RestaurantOdd = { placeId: string; name: string; percent: number }
type Bet = {
	id: string
	localDate: string
	placeId: string
	placeName: string
	stake: number
	status: 'open' | 'won' | 'lost' | 'cancelled' | 'refunded'
	payout: number | null
	probability: number | null
	updatedAt: string
	settledAt: string | null
}
type CurrentBets = { window: BettingWindow; bet: Bet | null; recent: Bet[] }
const oddsPrecision = 1_000_000
const minimumOddsPercent = 1 / oddsPrecision
function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
	const value = map.get(key)
	if (value === undefined) throw new Error('Expected map entry to exist')
	return value
}
const totalOddsUnits = 100 * oddsPrecision

function equalRestaurantOddsDraft(
	places: RestaurantOdd[],
): Record<string, string> {
	if (!places.length) return {}
	const shareUnits = Math.floor(totalOddsUnits / places.length)
	const remainderUnits = totalOddsUnits % places.length
	return Object.fromEntries(
		places.map((place, index) => [
			place.placeId,
			`${(shareUnits + (index < remainderUnits ? 1 : 0)) / oddsPrecision}`,
		]),
	)
}

function equalizeSelectedRestaurantOddsDraft(
	places: RestaurantOdd[],
	current: Record<string, string>,
	selectedPlaceIds: string[],
): Record<string, string> {
	const selectedIds = new Set(
		selectedPlaceIds.filter((placeId) =>
			places.some((place) => place.placeId === placeId),
		),
	)
	if (!selectedIds.size) return current
	if (selectedIds.size === places.length)
		return equalRestaurantOddsDraft(places)

	const selectedShareUnits = Math.floor(totalOddsUnits / places.length)
	const remainingPlaces = places.filter(
		(place) => !selectedIds.has(place.placeId),
	)
	let remainingUnits = totalOddsUnits - selectedShareUnits * selectedIds.size
	const weights = new Map(
		remainingPlaces.map((place) => {
			const draftPercent = Number(current[place.placeId])
			const weight =
				Number.isFinite(draftPercent) && draftPercent > 0
					? draftPercent
					: place.percent
			return [place.placeId, Number.isFinite(weight) && weight > 0 ? weight : 1]
		}),
	)
	const units = new Map<string, number>()
	let unassigned = [...remainingPlaces]

	while (unassigned.length) {
		const totalWeight = unassigned.reduce(
			(sum, place) => sum + requiredMapValue(weights, place.placeId),
			0,
		)
		const belowMinimum = unassigned.filter(
			(place) =>
				(remainingUnits * requiredMapValue(weights, place.placeId)) /
					totalWeight <
				1,
		)
		if (belowMinimum.length) {
			for (const place of belowMinimum) units.set(place.placeId, 1)
			remainingUnits -= belowMinimum.length
			const belowMinimumIds = new Set(
				belowMinimum.map((place) => place.placeId),
			)
			unassigned = unassigned.filter(
				(place) => !belowMinimumIds.has(place.placeId),
			)
			continue
		}

		const allocations = unassigned.map((place) => {
			const exactUnits =
				(remainingUnits * requiredMapValue(weights, place.placeId)) /
				totalWeight
			const wholeUnits = Math.floor(exactUnits)
			units.set(place.placeId, wholeUnits)
			return { placeId: place.placeId, fraction: exactUnits - wholeUnits }
		})
		let remainder =
			remainingUnits -
			allocations.reduce(
				(sum, item) => sum + requiredMapValue(units, item.placeId),
				0,
			)
		allocations.sort((left, right) => right.fraction - left.fraction)
		for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
			const allocation = allocations[index % allocations.length]
			if (!allocation) break
			const placeId = allocation.placeId
			units.set(placeId, requiredMapValue(units, placeId) + 1)
		}
		break
	}

	return Object.fromEntries(
		places.map((place) => [
			place.placeId,
			`${
				(selectedIds.has(place.placeId)
					? selectedShareUnits
					: requiredMapValue(units, place.placeId)) / oddsPrecision
			}`,
		]),
	)
}

function redistributeRestaurantOdds(
	places: RestaurantOdd[],
	current: Record<string, string>,
	changedPlaceId: string,
	requestedPercent: number,
): Record<string, string> {
	if (places.length === 1) {
		const onlyPlace = places[0]
		if (onlyPlace) return { [onlyPlace.placeId]: '100.000000' }
	}

	const otherPlaces = places.filter((place) => place.placeId !== changedPlaceId)
	if (!otherPlaces.length) return current

	const minUnits = 1
	const maxChangedUnits = totalOddsUnits - minUnits * otherPlaces.length
	const changedUnits = Math.min(
		maxChangedUnits,
		Math.max(minUnits, Math.round(requestedPercent * oddsPrecision)),
	)
	let remainingUnits = totalOddsUnits - changedUnits
	const weights = new Map(
		otherPlaces.map((place) => {
			const draftPercent = Number(current[place.placeId])
			const weight =
				Number.isFinite(draftPercent) && draftPercent > 0
					? draftPercent
					: place.percent
			return [place.placeId, Number.isFinite(weight) && weight > 0 ? weight : 1]
		}),
	)
	const units = new Map<string, number>()
	let unassigned = [...otherPlaces]

	while (unassigned.length) {
		const totalWeight = unassigned.reduce(
			(sum, place) => sum + requiredMapValue(weights, place.placeId),
			0,
		)
		const belowMinimum = unassigned.filter(
			(place) =>
				(remainingUnits * requiredMapValue(weights, place.placeId)) /
					totalWeight <
				minUnits,
		)
		if (belowMinimum.length) {
			for (const place of belowMinimum) units.set(place.placeId, minUnits)
			remainingUnits -= belowMinimum.length * minUnits
			const belowMinimumIds = new Set(
				belowMinimum.map((place) => place.placeId),
			)
			unassigned = unassigned.filter(
				(place) => !belowMinimumIds.has(place.placeId),
			)
			continue
		}

		const allocations = unassigned.map((place) => {
			const exactUnits =
				(remainingUnits * requiredMapValue(weights, place.placeId)) /
				totalWeight
			const wholeUnits = Math.floor(exactUnits)
			units.set(place.placeId, wholeUnits)
			return { placeId: place.placeId, fraction: exactUnits - wholeUnits }
		})
		let remainder =
			remainingUnits -
			allocations.reduce((sum, item) => {
				return sum + requiredMapValue(units, item.placeId)
			}, 0)
		allocations.sort((left, right) => right.fraction - left.fraction)
		for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
			const allocation = allocations[index % allocations.length]
			if (!allocation) break
			const placeId = allocation.placeId
			units.set(placeId, requiredMapValue(units, placeId) + 1)
		}
		break
	}

	const next = Object.fromEntries(
		places.map((place) => [
			place.placeId,
			`${(units.get(place.placeId) ?? changedUnits) / oddsPrecision}`,
		]),
	)
	const otherUnits = otherPlaces.reduce(
		(sum, place) => sum + requiredMapValue(units, place.placeId),
		0,
	)
	next[changedPlaceId] = `${(totalOddsUnits - otherUnits) / oddsPrecision}`
	return next
}
type RestaurantEconomySettings = EconomySettings & {
	removePlaceCost: number
	newPlaceMultiplier: number
}
const fallbackEconomySettings: RestaurantEconomySettings = {
	...defaultEconomySettings,
	removePlaceCost: 40,
	newPlaceMultiplier: 1,
}
type Pending = {
	key: string
	route: string
	body: unknown
	participantId?: string
	createdAt: number
}
const storageKey = 'lunch-roller.participant-id'
const pendingKey = 'lunch-roller.pending-action'
class ApiRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message)
	}
}

async function request<T>(
	route: string,
	options: RequestInit = {},
	participantId?: string,
): Promise<T> {
	const headers = new Headers(options.headers)
	if (options.body) headers.set('Content-Type', 'application/json')
	if (participantId) headers.set('X-Participant-Id', participantId)
	const response = await fetch(`/api/v1${route}`, {
		...options,
		headers,
		cache: 'no-store',
	})
	if (response.status === 204) return undefined as T
	const data = (await response.json()) as T & ApiError
	if (!response.ok)
		throw new ApiRequestError(
			data.error?.message ?? 'The request could not be completed.',
			response.status,
			data.error?.code,
		)
	return data
}

function json(body: unknown): string {
	return JSON.stringify(body)
}
function uuid() {
	return crypto.randomUUID()
}
function moneyLabel(delta: number) {
	return `${delta > 0 ? '+' : ''}${delta} tokens`
}
const workspaceViews = ['wheel', 'activity', 'standings'] as const
export default function Home() {
	const [mainView, setMainView] =
		useState<(typeof workspaceViews)[number]>('wheel')
	const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
	const [entryStage, setEntryStage] = useState<
		'loading' | 'setup' | 'name' | 'game'
	>('loading')
	const [participants, setParticipants] = useState<Participant[]>([])
	const [allParticipants, setAllParticipants] = useState<Participant[]>([])
	const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({})
	const [balanceDrafts, setBalanceDrafts] = useState<
		Record<string, { balance: string; reason: string }>
	>({})
	const [restaurantOdds, setRestaurantOdds] = useState<RestaurantOdd[]>([])
	const [restaurantOddsDraft, setRestaurantOddsDraft] = useState<
		Record<string, string>
	>({})
	const [selectedOddsPlaceIds, setSelectedOddsPlaceIds] = useState<string[]>([])
	const [showFairOdds, setShowFairOdds] = useState(false)
	const [places, setPlaces] = useState<Place[]>([])
	const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({})
	const [today, setToday] = useState<TodayResponse | null>(null)
	const wheelDisplayKey = today
		? `${today.wheel.mode}:${today.wheel.localDate}`
		: ''
	const wheelMode = today?.wheel.mode
	const savedResult = today?.result
	const [wallet, setWallet] = useState<WalletResponse | null>(null)
	const [currentBets, setCurrentBets] = useState<CurrentBets | null>(null)
	const [currentInfluence, setCurrentInfluence] =
		useState<CurrentInfluenceResponse | null>(null)
	const [influenceBusy, setInfluenceBusy] = useState(false)
	const [influenceError, setInfluenceError] = useState('')
	const [betStakeDraft, setBetStakeDraft] = useState('1')
	const [betPlaceDraft, setBetPlaceDraft] = useState('')
	const [betBusy, setBetBusy] = useState(false)
	const [betError, setBetError] = useState('')
	const [betNotice, setBetNotice] = useState('')
	const latestBetRequest = useRef(0)
	const latestInfluenceRequest = useRef(0)
	const [checkInConfirmOpen, setCheckInConfirmOpen] = useState(false)
	const checkInTrigger = useRef<HTMLButtonElement | null>(null)
	const checkInConfirmed = useRef(false)
	const checkInSubmitting = useRef(false)
	const cancelCheckIn = useRef<HTMLButtonElement | null>(null)
	const confirmCheckIn = useRef<HTMLButtonElement | null>(null)
	const checkInConfirmation = useRef<HTMLParagraphElement | null>(null)
	const [attendance, setAttendance] = useState<{
		participantId: string
		drawId: string
		status: AttendanceStatus
	} | null>(null)
	const [participantId, setParticipantId] = useState('')
	const [admin, setAdmin] = useState(false)
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState('')
	const [error, setError] = useState('')
	const [pollingError, setPollingError] = useState('')
	const [showAllLedger, setShowAllLedger] = useState(false)
	const latestTodayRequest = useRef(0)
	const [nameDraft, setNameDraft] = useState('')
	const [adminPassword, setAdminPassword] = useState('')
	const [newName, setNewName] = useState('')
	const [setupPlaceName, setSetupPlaceName] = useState('')
	const [setupHealthLevel, setSetupHealthLevel] =
		useState<HealthLevel>('balanced')
	const [healthRule, setHealthRule] = useState<HealthRuleSettings>(
		defaultHealthRuleSettings,
	)
	const [finishingSetup, setFinishingSetup] = useState(false)
	const [editingPersonId, setEditingPersonId] = useState('')
	const [editingPersonName, setEditingPersonName] = useState('')
	const [editingPlaceId, setEditingPlaceId] = useState('')
	const [editingPlaceName, setEditingPlaceName] = useState('')
	const [schedule, setSchedule] = useState<Schedule>({
		timezone: 'Europe/Dublin',
		time: '11:30',
		weekdays: [1, 2, 3, 4, 5],
	})
	const [drawSkip, setDrawSkip] = useState<DrawSkip>({
		localDate: null,
		cancellable: false,
	})
	const [preferences, setPreferences] = useState<GamePreferences>(
		defaultGamePreferences,
	)
	const [economy, setEconomy] = useState<RestaurantEconomySettings>(
		fallbackEconomySettings,
	)
	const [pushOn, setPushOn] = useState(false)
	const [pushBusy, setPushBusy] = useState(false)
	const pushBusyRef = useRef(false)
	const [pushConfigLoaded, setPushConfigLoaded] = useState(false)
	const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
	const latestAttendanceRequest = useRef(0)
	const [removeTarget, setRemoveTarget] = useState<Participant | null>(null)
	const removeTrigger = useRef<HTMLButtonElement | null>(null)
	const cancelRemoval = useRef<HTMLButtonElement | null>(null)
	const confirmRemoval = useRef<HTMLButtonElement | null>(null)
	const adminDisclosure = useRef<HTMLDetailsElement | null>(null)

	const clockAnchor = useRef<{ serverMs: number; clientMs: number } | null>(
		null,
	)
	const getServerNow = useCallback(() => {
		const anchor = clockAnchor.current
		return anchor
			? anchor.serverMs + performance.now() - anchor.clientMs
			: Date.now()
	}, [])
	const loadToday = useCallback(async () => {
		const requestId = ++latestTodayRequest.current
		const requestedAt = performance.now()
		const data = await request<TodayResponse>('/today')
		if (requestId === latestTodayRequest.current) {
			clockAnchor.current = serverClockAnchor(
				data.serverTime,
				requestedAt,
				performance.now(),
				Date.now(),
			)
			setToday(data)
		}
		return data
	}, [])
	const {
		wheelRef,
		rotation,
		pointerColor: animationPointerColor,
		spin,
		live: liveReveal,
		snapshot: animationSnapshot,
		replay: replayResult,
		celebration,
		closeCelebration,
	} = useWheelAnimation({
		result: savedResult,
		mode: wheelMode,
		displayKey: wheelDisplayKey,
		getServerNow,
		revealPending: Boolean(
			savedResult?.animation &&
				today?.serverTime &&
				spinIsLive(savedResult.animation, Date.parse(today.serverTime)),
		),
		colors: wheelColors,
	})

	const refresh = useCallback(
		async (selected: string) => {
			try {
				const [roster] = await Promise.all([
					request<{ participants: Participant[] }>('/participants'),
					loadToday(),
				])
				setParticipants(roster.participants)
				if (selected) {
					try {
						setWallet(await request<WalletResponse>('/wallet', {}, selected))
					} catch (caught) {
						if (
							caught instanceof ApiRequestError &&
							[401, 403, 404].includes(caught.status) &&
							(caught.code === 'IDENTITY_REQUIRED' ||
								caught.code?.includes('PARTICIPANT') ||
								caught.code?.includes('IDENTITY'))
						) {
							localStorage.removeItem(storageKey)
							setParticipantId('')
							setWallet(null)
							setNameDraft('')
							setEntryStage('name')
							return false
						} else throw caught
					}
				} else setWallet(null)
				if (selected) {
					const influenceRequest = ++latestInfluenceRequest.current
					try {
						const influence = currentInfluenceResponse.parse(
							await request<CurrentInfluenceResponse>(
								'/influence/current',
								{},
								selected,
							),
						)
						if (
							influenceRequest === latestInfluenceRequest.current &&
							localStorage.getItem(storageKey) === selected
						) {
							setCurrentInfluence(influence)
							setInfluenceError('')
						}
					} catch {
						if (
							influenceRequest === latestInfluenceRequest.current &&
							localStorage.getItem(storageKey) === selected
						)
							setInfluenceError(
								'Could not refresh positions. Controls are paused until the next successful update.',
							)
					}
				} else setCurrentInfluence(null)
				setPollingError('')
				return true
			} catch (caught) {
				setPollingError(
					'Could not refresh the lunch wheel. It will retry shortly.',
				)
				throw caught
			}
		},
		[loadToday],
	)

	const refreshAdmin = useCallback(async () => {
		const [
			people,
			locations,
			balances,
			savedOdds,
			savedSchedule,
			savedPreferences,
			savedEconomy,
			savedHealthRule,
			savedDrawSkip,
		] = await Promise.all([
			request<{ participants: Participant[] }>('/admin/participants'),
			request<{ places: Place[] }>('/admin/places'),
			request<{ balances: TokenBalanceRow[] }>('/admin/token-balances'),
			request<{ places: RestaurantOdd[] }>('/admin/restaurant-odds'),
			request<Schedule>('/admin/schedule'),
			request<GamePreferences>('/admin/preferences'),
			request<RestaurantEconomySettings>('/admin/economy'),
			request<HealthRuleSettings>('/admin/health-rule'),
			request<DrawSkip>('/admin/draw-skip'),
		])
		setAllParticipants(people.participants)
		const balanceMap = Object.fromEntries(
			balances.balances.map(({ participantId, balance }) => [
				participantId,
				balance,
			]),
		)
		setTokenBalances(balanceMap)
		setBalanceDrafts(
			Object.fromEntries(
				balances.balances.map(({ participantId, balance }) => [
					participantId,
					{ balance: String(balance), reason: '' },
				]),
			),
		)
		setPlaces(locations.places)
		setWeightDrafts(
			Object.fromEntries(
				locations.places.map((place) => [
					place.id,
					weightInput(place.logWeight),
				]),
			),
		)
		setHealthRule(savedHealthRule)
		setRestaurantOdds(savedOdds.places)
		setSelectedOddsPlaceIds([])
		setRestaurantOddsDraft(
			Object.fromEntries(
				savedOdds.places.map(({ placeId, percent }) => [
					placeId,
					String(Number(percent.toPrecision(8))),
				]),
			),
		)
		setSchedule(savedSchedule)
		setDrawSkip(savedDrawSkip)
		setPreferences(savedPreferences)
		setEconomy(savedEconomy)
		setAdmin(true)
	}, [])

	const loadSetupStatus = useCallback(async () => {
		const status = await request<SetupStatus>('/setup')
		setSetupStatus(status)
		return status
	}, [])

	useEffect(() => {
		let mounted = true
		const initialize = async () => {
			try {
				const status = await loadSetupStatus()
				if (!mounted) return
				if (!status.completed) {
					setEntryStage('setup')
					try {
						await refreshAdmin()
					} catch {
						// The setup gate remains available to an administrator who signs in here.
					}
					return
				}
				const saved = localStorage.getItem(storageKey) ?? ''
				if (saved) {
					try {
						const selected = await request<Participant>('/identity/select', {
							method: 'POST',
							body: json({ participantId: saved }),
						})
						if (!mounted) return
						setParticipantId(selected.id)
						const valid = await refresh(selected.id)
						if (mounted && valid) setEntryStage('game')
						return
					} catch (caught) {
						if (
							!(caught instanceof ApiRequestError) ||
							![400, 401, 403, 404].includes(caught.status)
						)
							throw caught
						localStorage.removeItem(storageKey)
					}
				}
				if (!mounted) return
				setParticipantId('')
				setEntryStage('name')
				const roster = await request<{ participants: Participant[] }>(
					'/participants',
				)
				if (mounted) setParticipants(roster.participants)
			} catch {
				if (mounted)
					setPollingError('Could not load setup status. Please retry.')
			}
		}
		void initialize()
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker
				.register('/service-worker.js')
				.then(async () => {
					const registration = await navigator.serviceWorker.ready
					const hasSubscription = Boolean(
						await registration.pushManager.getSubscription(),
					)
					const linkedParticipant = localStorage.getItem(
						'lunch-roller.push-participant-id',
					)
					const selectedParticipant = localStorage.getItem(storageKey)
					setPushOn(
						hasSubscription && linkedParticipant === selectedParticipant,
					)
				})
				.catch(() => undefined)
		}
		void request<{ publicKey: string | null }>('/push-config')
			.then((config) => setPushPublicKey(config.publicKey))
			.catch(() => setPushPublicKey(null))
			.finally(() => setPushConfigLoaded(true))
		return () => {
			mounted = false
		}
	}, [loadSetupStatus, refresh, refreshAdmin])

	useEffect(() => {
		if (entryStage !== 'game') return
		const interval = window.setInterval(
			() => void refresh(participantId).catch(() => undefined),
			30000,
		)
		return () => window.clearInterval(interval)
	}, [entryStage, participantId, refresh])

	useEffect(() => {
		if (entryStage !== 'game' || !today) return
		let loading = false
		const tick = async (wake = false) => {
			if (document.hidden || loading) return
			const now = getServerNow()
			const dueAt = scheduledInstant(
				today.localDate,
				today.schedule.time,
				today.schedule.timezone,
			).getTime()
			const nearDraw = today.status === 'pending' && now >= dueAt - 60000
			const live = today.result && spinIsLive(animationPlan(today.result), now)
			if (!wake && !nearDraw && !live) return
			loading = true
			try {
				await loadToday()
			} catch {
				/* The normal refresh reports connection failures. */
			} finally {
				loading = false
			}
		}
		const timer = window.setInterval(() => void tick(), 1000)
		const wake = () => {
			if (!document.hidden) void tick(true)
		}
		document.addEventListener('visibilitychange', wake)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', wake)
		}
	}, [entryStage, today, getServerNow, loadToday])

	const refreshBets = useCallback(async (selected: string) => {
		const requestId = ++latestBetRequest.current
		if (!selected) {
			setCurrentBets(null)
			return
		}
		try {
			const data = await request<CurrentBets>('/bets/current', {}, selected)
			if (requestId !== latestBetRequest.current) return
			setCurrentBets(data)
			setBetError('')
			setBetStakeDraft(data.bet ? String(data.bet.stake) : '1')
			setBetPlaceDraft(data.bet?.placeId ?? '')
		} catch (caught) {
			if (requestId !== latestBetRequest.current) return
			setBetError(
				caught instanceof Error
					? caught.message
					: 'Could not load your bet. Please retry.',
			)
		}
	}, [])

	const betCutoffAt = currentBets?.window.cutoffAt
	const betOpensAt = currentBets?.window.opensAt
	const wheelActivityPaused = Boolean(
		betOpensAt &&
			today?.serverTime &&
			Date.parse(today.serverTime) < Date.parse(betOpensAt),
	)
	const betWindowOpen = currentBets?.window.open && !wheelActivityPaused
	const wheelPauseMessage = betOpensAt
		? `Wheel activity reopens at ${new Intl.DateTimeFormat('en-GB', {
				timeZone: today?.schedule.timezone,
				hour: '2-digit',
				minute: '2-digit',
			}).format(new Date(betOpensAt))} (${today?.schedule.timezone ?? ''}).`
		: ''
	useEffect(() => {
		if (!participantId || !wheelActivityPaused || !betOpensAt) return
		const timer = window.setTimeout(
			() => {
				void refresh(participantId).catch(() => undefined)
				void refreshBets(participantId)
			},
			Math.max(0, Date.parse(betOpensAt) - getServerNow()),
		)
		return () => window.clearTimeout(timer)
	}, [
		participantId,
		wheelActivityPaused,
		betOpensAt,
		getServerNow,
		refresh,
		refreshBets,
	])
	useEffect(() => {
		if (!betCutoffAt || !betWindowOpen) return
		const timer = window.setTimeout(
			() => {
				setCurrentBets((current) =>
					current?.window.cutoffAt === betCutoffAt
						? { ...current, window: { ...current.window, open: false } }
						: current,
				)
			},
			Math.max(0, new Date(betCutoffAt).getTime() - getServerNow()),
		)
		return () => window.clearTimeout(timer)
	}, [betCutoffAt, betWindowOpen, getServerNow])

	async function saveBet(event: FormEvent) {
		event.preventDefault()
		if (
			!participantId ||
			!currentBets?.window.open ||
			wheelActivityPaused ||
			betBusy
		)
			return
		const stake = Number(betStakeDraft)
		if (!Number.isSafeInteger(stake) || stake < 1) {
			setBetError('Enter a whole token amount greater than zero.')
			return
		}
		if (!betPlaceDraft) {
			setBetError('Choose a lunch place first.')
			return
		}
		setBetBusy(true)
		setBetError('')
		setBetNotice('')
		try {
			await request(
				'/bets/current',
				{
					method: 'PUT',
					body: json({
						localDate: currentBets.window.localDate,
						placeId: betPlaceDraft,
						stake,
					}),
					headers: { 'Idempotency-Key': uuid() },
				},
				participantId,
			)
			await Promise.all([refresh(participantId), refreshBets(participantId)])
			setBetNotice('Your bet is saved. You can change it until betting closes.')
		} catch (caught) {
			setBetError(
				caught instanceof Error ? caught.message : 'Could not save your bet.',
			)
		} finally {
			setBetBusy(false)
		}
	}

	async function cancelBet() {
		if (!participantId || !currentBets?.bet || !betWindowOpen || betBusy) return
		setBetBusy(true)
		setBetError('')
		setBetNotice('')
		try {
			await request(
				'/bets/current',
				{
					method: 'DELETE',
					body: json({ localDate: currentBets.window.localDate }),
					headers: { 'Idempotency-Key': uuid() },
				},
				participantId,
			)
			await Promise.all([refresh(participantId), refreshBets(participantId)])
			setBetNotice('Your bet was cancelled and the tokens were returned.')
		} catch (caught) {
			setBetError(
				caught instanceof Error ? caught.message : 'Could not cancel your bet.',
			)
		} finally {
			setBetBusy(false)
		}
	}

	async function changeInfluence(
		placeId: string,
		action: 'boost' | 'reduce',
		change: 1 | -1,
	) {
		const market = currentInfluence
		if (
			!participantId ||
			!market?.window.open ||
			influenceBusy ||
			busy ||
			influenceError
		)
			return
		setInfluenceBusy(true)
		try {
			const updated = await mutate(
				'/influence/current',
				{
					localDate: market.window.localDate,
					placeId,
					action,
					change,
				},
				change === 1
					? (
							action === 'boost'
								? (market.places.find((place) => place.placeId === placeId)
										?.yourReductions ?? 0) > 0
								: (market.places.find((place) => place.placeId === placeId)
										?.yourBoosts ?? 0) > 0
						)
						? 'Position moved toward zero and original tokens refunded.'
						: `${action === 'boost' ? 'Boost' : 'Reduction'} staged for the next draw.`
					: `${action === 'boost' ? 'Boost' : 'Reduction'} withdrawn and tokens returned.`,
			)
			// Refresh after failures too: the cutoff or another tab may have changed.
			if (!updated) await refresh(participantId).catch(() => undefined)
			await refreshBets(participantId)
		} finally {
			setInfluenceBusy(false)
		}
	}

	useEffect(() => {
		if (entryStage !== 'game' || !participantId) return
		const timer = window.setTimeout(() => void refreshBets(participantId), 0)
		return () => window.clearTimeout(timer)
	}, [entryStage, participantId, refreshBets])

	useEffect(() => {
		const selectedId = participantId
		const drawId = today?.result?.id
		const requestId = ++latestAttendanceRequest.current
		if (entryStage !== 'game' || !selectedId || !drawId) return
		void request<AttendanceStatus>('/attendance', {}, selectedId)
			.then((status) => {
				if (
					requestId === latestAttendanceRequest.current &&
					participantId === selectedId &&
					today?.result?.id === drawId &&
					status.drawId === drawId
				) {
					setAttendance({ participantId: selectedId, drawId, status })
				}
			})
			.catch(() => undefined)
		return () => {
			if (requestId === latestAttendanceRequest.current)
				latestAttendanceRequest.current += 1
		}
	}, [entryStage, participantId, today])

	async function refundSpot(placeId: string) {
		if (
			!participantId ||
			!currentInfluence?.window.open ||
			busy ||
			influenceBusy ||
			influenceError
		)
			return
		setInfluenceBusy(true)
		try {
			await mutate(
				'/influence/refund',
				{ localDate: currentInfluence.window.localDate, placeId },
				'Staged boosts and reductions refunded.',
			)
		} finally {
			setInfluenceBusy(false)
		}
	}

	function changeName() {
		latestAttendanceRequest.current += 1
		latestBetRequest.current += 1
		latestInfluenceRequest.current += 1
		setCurrentBets(null)
		setCurrentInfluence(null)
		setInfluenceError('')
		setAttendance(null)
		localStorage.removeItem(storageKey)
		setParticipantId('')
		setWallet(null)
		setNameDraft('')
		setEntryStage('name')
		void request<{ participants: Participant[] }>('/participants')
			.then((roster) => setParticipants(roster.participants))
			.catch(() => setError('Could not load the active roster.'))
	}

	const odds = useMemo(() => today?.odds ?? [], [today])
	const currentEconomy: RestaurantEconomySettings = {
		...fallbackEconomySettings,
		...today?.economy,
	}
	const baselineOptions = odds
	const activeReplay = animationSnapshot
	const wheelOptions = activeReplay ?? baselineOptions
	const gradient = useMemo(() => {
		if (!wheelOptions.length) return '#d9ddd1'
		let at = 0
		const stops = wheelOptions.map((option, index) => {
			const start = at
			at += option.probability * 360
			return `${wheelColors[index % wheelColors.length]} ${start}deg ${at}deg`
		})
		return `conic-gradient(${stops.join(',')})`
	}, [wheelOptions])
	const pointerColor =
		spin || activeReplay
			? animationPointerColor
			: wheelSliceColor(wheelOptions, rotation, wheelColors)

	async function selectParticipant(event: FormEvent) {
		event.preventDefault()
		setBusy(true)
		setError('')
		try {
			const selected = await request<Participant>('/identity/select', {
				method: 'POST',
				body: json({ participantId: nameDraft }),
			})
			localStorage.setItem(storageKey, selected.id)
			setParticipantId(selected.id)
			setPushOn(
				localStorage.getItem('lunch-roller.push-participant-id') ===
					selected.id,
			)
			setNameDraft('')
			if (!(await refresh(selected.id))) return
			setEntryStage('game')
			setNotice(`You’re in as ${selected.name}.`)
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: 'Could not select that name.',
			)
		} finally {
			setBusy(false)
		}
	}

	async function mutate(
		route: string,
		payload: unknown,
		message: string,
	): Promise<boolean> {
		if (!participantId) {
			setError('Choose your name before using tokens.')
			return false
		}
		let pending: Pending
		try {
			const previous = localStorage.getItem(pendingKey)
			const candidate = previous ? (JSON.parse(previous) as Pending) : null
			pending =
				candidate &&
				candidate.route === route &&
				candidate.participantId === participantId &&
				JSON.stringify(candidate.body) === JSON.stringify(payload) &&
				Date.now() - candidate.createdAt < 86400000
					? candidate
					: {
							key: uuid(),
							route,
							body: payload,
							participantId,
							createdAt: Date.now(),
						}
			localStorage.setItem(pendingKey, JSON.stringify(pending))
		} catch {
			pending = {
				key: uuid(),
				route,
				body: payload,
				participantId,
				createdAt: Date.now(),
			}
		}
		setBusy(true)
		setError('')
		try {
			const result = await request<{
				awardedTokens?: number
				spentTokens?: number
			}>(
				route,
				{
					method: 'POST',
					body: json(payload),
					headers: { 'Idempotency-Key': pending.key },
				},
				participantId,
			)
			if (route === '/attendance') {
				localStorage.removeItem(pendingKey)
				const drawId = (payload as { drawId: string }).drawId
				latestAttendanceRequest.current += 1
				setAttendance({
					participantId,
					drawId,
					status: { drawId, checkedIn: true, open: true },
				})
				setNotice(
					route === '/attendance' && result.awardedTokens !== undefined
						? `Check-in complete — ${result.awardedTokens} tokens added.`
						: message,
				)
				try {
					await refresh(participantId)
				} catch {
					// A committed check-in stays confirmed even if the page refresh fails.
				}
				return true
			}
			await refresh(participantId)
			if (
				route === '/purchases' &&
				(payload as { action?: string }).action === 'remove'
			)
				await refreshBets(participantId)
			localStorage.removeItem(pendingKey)
			setNotice(
				(route === '/places' || route === '/purchases') &&
					result.spentTokens !== undefined
					? route === '/places'
						? `Restaurant added or restored for ${result.spentTokens} tokens.`
						: (payload as { action?: string }).action === 'remove'
							? `Restaurant banished for ${result.spentTokens} tokens.`
							: message
					: message,
			)
			return true
		} catch (caught) {
			if (
				route === '/attendance' &&
				caught instanceof ApiRequestError &&
				caught.code === 'ALREADY_ATTENDED'
			) {
				const drawId = (payload as { drawId: string }).drawId
				latestAttendanceRequest.current += 1
				setAttendance({
					participantId,
					drawId,
					status: { drawId, checkedIn: true, open: true },
				})
				try {
					const status = await request<AttendanceStatus>(
						'/attendance',
						{},
						participantId,
					)
					if (status.drawId === drawId && status.checkedIn) {
						setAttendance({ participantId, drawId, status })
						setNotice('You have already checked in for today.')
						return true
					}
				} catch {
					// Keep the original request error visible if reconciliation fails.
				}
			}
			setError(
				caught instanceof Error
					? caught.message
					: 'The action could not be completed.',
			)
			return false
		} finally {
			setBusy(false)
		}
	}

	async function login(event: FormEvent) {
		event.preventDefault()
		setBusy(true)
		setError('')
		try {
			await request('/admin/session', {
				method: 'POST',
				body: json({ password: adminPassword }),
			})
			setAdminPassword('')
			await refreshAdmin()
			await loadSetupStatus()
			setNotice('Administrator tools unlocked.')
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Login failed.')
		} finally {
			setBusy(false)
		}
	}

	async function adminSave(
		route: string,
		method: string,
		payload: unknown,
		done: string,
	) {
		if (busy) return
		setBusy(true)
		setError('')
		try {
			let headers: HeadersInit | undefined
			if (
				route === '/admin/token-corrections' ||
				route === '/admin/token-balances'
			) {
				const key = `lunch-roller.${route.split('/').at(-1)}-request`
				const prior = sessionStorage.getItem(key)
				const candidate = prior ? (JSON.parse(prior) as Pending) : null
				const pending =
					candidate &&
					JSON.stringify(candidate.body) === JSON.stringify(payload) &&
					Date.now() - candidate.createdAt < 86400000
						? candidate
						: { key: uuid(), route, body: payload, createdAt: Date.now() }
				sessionStorage.setItem(key, JSON.stringify(pending))
				headers = { 'Idempotency-Key': pending.key }
			}
			await request(route, { method, body: json(payload), headers })
			await refreshAdmin()
			const status = await loadSetupStatus()
			if (status.completed) {
				await refresh(participantId)
				if (route === '/admin/draw-skip') await refreshBets(participantId)
			}
			setNotice(done)
			if (
				route === '/admin/token-corrections' ||
				route === '/admin/token-balances'
			)
				sessionStorage.removeItem(
					`lunch-roller.${route.split('/').at(-1)}-request`,
				)
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : 'Could not save changes.',
			)
		} finally {
			setBusy(false)
		}
	}

	async function completeFirstRunSetup() {
		if (busy || !admin || !setupStatus) return
		setFinishingSetup(true)
		setBusy(true)
		setError('')
		try {
			const status = await request<SetupStatus>('/admin/setup/complete', {
				method: 'POST',
			})
			setSetupStatus(status)
			setParticipants(
				(await request<{ participants: Participant[] }>('/participants'))
					.participants,
			)
			setEntryStage('name')
			setNotice('Setup is complete. Choose your name to enter the lunch wheel.')
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : 'Could not complete setup.',
			)
			await loadSetupStatus().catch(() => undefined)
			await refreshAdmin().catch(() => undefined)
		} finally {
			setFinishingSetup(false)
			setBusy(false)
		}
	}

	async function togglePush() {
		if (pushBusyRef.current) return
		pushBusyRef.current = true
		setPushBusy(true)
		setError('')
		try {
			if (
				!('Notification' in window) ||
				!('serviceWorker' in navigator) ||
				!('PushManager' in window)
			) {
				throw new Error('Push notifications are not supported by this browser.')
			}
			if (pushConfigLoaded && !pushPublicKey)
				throw new Error('Push notifications are not configured yet.')
			if (!participantId)
				throw new Error('Choose your name before enabling notifications.')
			const permission = await Notification.requestPermission()
			if (permission !== 'granted') {
				setPushOn(false)
				throw new Error(
					'Notifications were not enabled. You can still play without them.',
				)
			}
			const config = pushConfigLoaded
				? { publicKey: pushPublicKey }
				: await request<{ publicKey: string | null }>('/push-config')
			if (!config.publicKey)
				throw new Error('Push notifications are not configured yet.')
			const registration = await navigator.serviceWorker.ready
			if (!registration.pushManager)
				throw new Error('Push notifications are not supported by this browser.')
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: Uint8Array.from(
					atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
					(c) => c.charCodeAt(0),
				),
			})
			const result = await request<{ id: string }>(
				'/push-subscriptions',
				{ method: 'POST', body: json(subscription.toJSON()) },
				participantId,
			)
			localStorage.setItem('lunch-roller.push-subscription', result.id)
			localStorage.setItem('lunch-roller.push-participant-id', participantId)
			setPushOn(true)
			setNotice('Lunch and token alerts enabled for this browser.')
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: 'Could not enable notifications.',
			)
		} finally {
			pushBusyRef.current = false
			setPushBusy(false)
		}
	}

	async function disablePush() {
		if (pushBusyRef.current) return
		pushBusyRef.current = true
		setPushBusy(true)
		try {
			const id = localStorage.getItem('lunch-roller.push-subscription')
			if (id && participantId)
				await request(
					`/push-subscriptions/${id}`,
					{ method: 'DELETE' },
					participantId,
				)
			if ('serviceWorker' in navigator) {
				const registration = await navigator.serviceWorker.ready
				await registration.pushManager
					?.getSubscription()
					.then((subscription) => subscription?.unsubscribe())
			}
			localStorage.removeItem('lunch-roller.push-subscription')
			localStorage.removeItem('lunch-roller.push-participant-id')
			setPushOn(false)
			setNotice('Lunch notifications disabled.')
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: 'Could not disable notifications.',
			)
		} finally {
			pushBusyRef.current = false
			setPushBusy(false)
		}
	}

	const currentName = participants.find(
		(person) => person.id === participantId,
	)?.name
	const displayedDrawId = today?.result?.id ?? null
	const displayedAttendance =
		attendance &&
		attendance.participantId === participantId &&
		attendance.drawId === displayedDrawId
			? attendance.status
			: null
	const canCheckIn = Boolean(
		displayedDrawId &&
			displayedAttendance?.drawId === displayedDrawId &&
			displayedAttendance.open &&
			!displayedAttendance.checkedIn,
	)
	const wheelTargetDate = today?.wheel.localDate
	const wheelTargetLabel = wheelTargetDate
		? calendarDateLabel(wheelTargetDate)
		: ''

	const closeCheckInDialog = useCallback(() => {
		setCheckInConfirmOpen(false)
		window.setTimeout(() => checkInTrigger.current?.focus(), 0)
	}, [])

	useEffect(() => {
		if (!removeTarget) return
		cancelRemoval.current?.focus()
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setRemoveTarget(null)
				window.setTimeout(() => removeTrigger.current?.focus(), 0)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [removeTarget])

	useEffect(() => {
		if (!checkInConfirmOpen) return
		cancelCheckIn.current?.focus()
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeCheckInDialog()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [checkInConfirmOpen, closeCheckInDialog])

	async function removeParticipant() {
		if (!removeTarget || busy) return
		const person = removeTarget
		setBusy(true)
		setError('')
		try {
			const result = await request<ParticipantRemoval>(
				`/admin/participants/${person.id}`,
				{ method: 'DELETE' },
			)
			setRemoveTarget(null)
			await refreshAdmin()
			await refresh(participantId)
			setNotice(
				result.action === 'deleted'
					? `${person.name} was permanently deleted.`
					: `${person.name} was archived; history was preserved.`,
			)
			window.setTimeout(
				() => document.querySelector<HTMLElement>('.admin-tool-card')?.focus(),
				0,
			)
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: 'Could not remove this person.',
			)
		} finally {
			setBusy(false)
		}
	}

	const activePeople = allParticipants.filter((person) => person.active).length
	const activePlaces = places.filter((place) => place.active).length
	const restaurantOddsTotal = restaurantOdds.reduce(
		(total, place) => total + Number(restaurantOddsDraft[place.placeId]),
		0,
	)
	const selectedOddsCount = restaurantOdds.filter((place) =>
		selectedOddsPlaceIds.includes(place.placeId),
	).length
	const restaurantOddsAreValid =
		restaurantOdds.length > 0 &&
		restaurantOdds.every((place) => {
			const percent = Number(restaurantOddsDraft[place.placeId])
			return Number.isFinite(percent) && percent > 0 && percent <= 100
		}) &&
		Math.abs(restaurantOddsTotal - 100) <= 0.01
	const updateRestaurantOdds = (placeId: string, rawPercent: string) => {
		if (!rawPercent) {
			setRestaurantOddsDraft({ ...restaurantOddsDraft, [placeId]: '' })
			return
		}
		const percent = Number(rawPercent)
		if (!Number.isFinite(percent) || percent <= 0) {
			setRestaurantOddsDraft({ ...restaurantOddsDraft, [placeId]: rawPercent })
			return
		}
		setRestaurantOddsDraft(
			redistributeRestaurantOdds(
				restaurantOdds,
				restaurantOddsDraft,
				placeId,
				percent,
			),
		)
	}
	const entryGate = (
		<>
			{entryStage === 'loading' ? (
				<section
					className="setup-card"
					data-testid="setup-loading"
					aria-live="polite"
				>
					<p className="eyebrow">WELCOME TO GAMBLING ABOUT LUNCH</p>
					<h2>Checking lunch setup…</h2>
					{pollingError && (
						<>
							<p role="alert">{pollingError}</p>
							<button
								type="button"
								className="button button-light"
								onClick={() => window.location.reload()}
							>
								Retry
							</button>
						</>
					)}
				</section>
			) : entryStage === 'name' ? (
				<section className="setup-card" data-testid="name-picker">
					<Readiness />
					<p className="eyebrow">YOUR SEAT AT THE TABLE</p>
					<h2>Choose your name</h2>
					<p className="muted">
						Pick your name from the active team roster to enter the lunch wheel.
					</p>
					<form className="setup-form" onSubmit={selectParticipant}>
						<label htmlFor="entry-name">Your name</label>
						<select
							id="entry-name"
							value={nameDraft}
							onChange={(event) => setNameDraft(event.target.value)}
							required
						>
							<option value="">Choose your name</option>
							{participants.map((person) => (
								<option key={person.id} value={person.id}>
									{person.name}
								</option>
							))}
						</select>
						<button
							type="submit"
							className="button button-dark"
							disabled={busy || !nameDraft}
						>
							Enter lunch wheel
						</button>
					</form>
					{error && (
						<p className="setup-error" role="alert">
							{error}
						</p>
					)}
				</section>
			) : (
				<section
					className={`setup-card${admin ? ' setup-card-wide' : ''}`}
					data-testid="setup-admin-login"
				>
					<p className="eyebrow">WELCOME TO GAMBLING ABOUT LUNCH</p>
					<h2>Set up your lunch wheel</h2>
					<p className="muted">
						An administrator needs to add the team and lunch places before
						anyone can enter.
					</p>
					{!admin ? (
						<form className="setup-form" onSubmit={login}>
							<label htmlFor="first-run-password">Administrator password</label>
							<input
								id="first-run-password"
								type="password"
								value={adminPassword}
								onChange={(event) => setAdminPassword(event.target.value)}
								autoComplete="current-password"
								required
							/>
							<button
								type="submit"
								className="button button-dark"
								disabled={busy || !adminPassword}
							>
								Sign in as administrator
							</button>
						</form>
					) : (
						<div className="setup-admin-content">
							<h3>Build your lunch wheel</h3>
							<div className="setup-counts" aria-live="polite">
								<span>
									{activePeople} active{' '}
									{activePeople === 1 ? 'person' : 'people'}
								</span>
								<span>
									{activePlaces} active{' '}
									{activePlaces === 1 ? 'place' : 'places'}
								</span>
							</div>
							<div className="setup-columns">
								<section className="setup-step">
									<h4>People</h4>
									<form
										className="setup-form"
										onSubmit={(event) => {
											event.preventDefault()
											const form = event.currentTarget
											const name = new FormData(form)
												.get('setup-person')
												?.toString()
												.trim()
											if (name)
												void adminSave(
													'/admin/participants',
													'POST',
													{ name },
													'Person added.',
												).then(() => form.reset())
										}}
									>
										<label htmlFor="setup-person">New team member name</label>
										<input
											id="setup-person"
											name="setup-person"
											placeholder="Person’s name"
											maxLength={100}
											required
										/>
										<button
											type="submit"
											className="button button-light"
											disabled={busy}
										>
											Add person
										</button>
									</form>
									<ul className="setup-roster">
										{allParticipants
											.filter((person) => person.active)
											.map((person) => (
												<li key={person.id}>{person.name}</li>
											))}
									</ul>
								</section>
								<section className="setup-step">
									<h4>Lunch places</h4>
									<form
										className="setup-form"
										onSubmit={(event) => {
											event.preventDefault()
											const name = setupPlaceName.trim()
											if (name)
												void adminSave(
													'/admin/places',
													'POST',
													{ name, healthLevel: setupHealthLevel },
													'Place added.',
												).then(() => setSetupPlaceName(''))
										}}
									>
										<label htmlFor="setup-place">New lunch place</label>
										<input
											id="setup-place"
											value={setupPlaceName}
											onChange={(event) =>
												setSetupPlaceName(event.target.value)
											}
											placeholder="Lunch place name"
											maxLength={100}
											required
										/>
										<div className="place-create-actions">
											<button
												type="submit"
												className="button button-light"
												disabled={busy || !setupPlaceName.trim()}
											>
												Add place
											</button>
											<HealthSelect
												label="New place health level"
												value={setupHealthLevel}
												onChange={setSetupHealthLevel}
												disabled={busy}
											/>
										</div>
									</form>
									<ul className="setup-roster">
										{places
											.filter((place) => place.active)
											.map((place) => (
												<li key={place.id}>
													<span>{place.name}</span>{' '}
													<HealthBadge level={place.healthLevel} />
												</li>
											))}
									</ul>
								</section>
							</div>
							<section className="setup-step setup-schedule">
								<h4>Draw schedule</h4>
								<div className="setup-schedule-fields">
									<label>
										Time
										<input
											type="time"
											value={schedule.time}
											onChange={(event) =>
												setSchedule({ ...schedule, time: event.target.value })
											}
										/>
									</label>
									<label>
										Timezone
										<input
											value={schedule.timezone}
											onChange={(event) =>
												setSchedule({
													...schedule,
													timezone: event.target.value,
												})
											}
										/>
									</label>
								</div>
								<fieldset
									className="weekday-options"
									aria-label="Draw weekdays"
								>
									{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
										(day, index) => {
											const weekday = index + 1
											return (
												<label key={day}>
													<input
														type="checkbox"
														checked={schedule.weekdays.includes(weekday)}
														onChange={(event) =>
															setSchedule({
																...schedule,
																weekdays: event.target.checked
																	? [...schedule.weekdays, weekday].sort()
																	: schedule.weekdays.filter(
																			(value) => value !== weekday,
																		),
															})
														}
													/>
													{day}
												</label>
											)
										},
									)}
								</fieldset>
								<button
									type="button"
									className="button button-light"
									disabled={busy}
									onClick={() =>
										void adminSave(
											'/admin/schedule',
											'PUT',
											schedule,
											'Schedule saved.',
										)
									}
								>
									Save schedule
								</button>
							</section>
							<button
								type="button"
								className="button button-dark setup-finish"
								data-testid="setup-complete"
								disabled={
									busy || finishingSetup || activePeople < 1 || activePlaces < 1
								}
								onClick={() => void completeFirstRunSetup()}
							>
								{finishingSetup ? 'Finishing setup…' : 'Finish setup'}
							</button>
							<p className="muted setup-hint">
								You need at least one active person and one active lunch place.
							</p>
						</div>
					)}
					{error && (
						<p className="setup-error" role="alert">
							{error}
						</p>
					)}
				</section>
			)}
		</>
	)

	return (
		<main
			className={`site-shell${entryStage === 'game' ? '' : ' setup-shell'}`}
		>
			<header className="topbar">
				<a className="brand" href="#top" aria-label="Gambling about lunch home">
					<Image
						className="brand-logo"
						src="/android-chrome-192x192.png"
						alt=""
						width={192}
						height={192}
						priority
					/>
					<h1 className="brand-title">Gambling about lunch</h1>
				</a>
				<nav className="top-nav" aria-label="Primary navigation">
					<Link href="/" aria-current="page">
						Wheel
					</Link>
					<Link href="/suggestions">Suggestion board</Link>
				</nav>
				<div className="top-actions">
					<ThemeToggle />
					<RulesHelp
						today={today}
						window={currentBets?.window ?? null}
						onRefresh={loadToday}
					/>
					<span className="date-chip">
						{entryStage === 'setup'
							? 'FIRST-RUN SETUP'
							: (today?.localDate ?? 'TODAY')}{' '}
						· {today?.schedule.timezone ?? 'Europe/Dublin'}
					</span>
					{entryStage === 'game' && currentName && (
						<button
							type="button"
							className="quiet-link"
							data-testid="change-name"
							onClick={changeName}
						>
							Logout
						</button>
					)}
					{(entryStage === 'name' || entryStage === 'game') && (
						<button
							type="button"
							className="quiet-link"
							onClick={() => adminDisclosure.current?.setAttribute('open', '')}
						>
							Admin
						</button>
					)}
				</div>
			</header>

			{entryStage === 'game' && today?.wheel.localDate && (
				<CountdownBanner
					localDate={today.wheel.localDate}
					drawTime={today.schedule.time}
					timezone={today.schedule.timezone}
					window={currentBets?.window ?? null}
					fallbackCutoffMinutes={today.preferences.bettingCloseMinutes}
					getServerNow={getServerNow}
					spinning={liveReveal}
				/>
			)}

			{entryStage !== 'game' ? (
				entryGate
			) : (
				<>
					<section
						className={mainView === 'wheel' ? 'hero hero-wheel' : 'hero'}
						id="top"
						aria-label="Lunch workspace"
					>
						<div className="wheel-card">
							<div
								className="workspace-tabs"
								role="tablist"
								aria-label="Lunch workspace"
							>
								{workspaceViews.map((view) => (
									<button
										key={view}
										id={`${view}-tab`}
										type="button"
										role="tab"
										aria-selected={mainView === view}
										aria-controls={`${view}-panel`}
										tabIndex={mainView === view ? 0 : -1}
										onClick={() => setMainView(view)}
										onKeyDown={(event) => {
											if (
												!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
													event.key,
												)
											)
												return
											event.preventDefault()
											const viewIndex = workspaceViews.indexOf(view)
											const next =
												event.key === 'Home'
													? 'wheel'
													: event.key === 'End'
														? 'standings'
														: (workspaceViews[
																(viewIndex +
																	(event.key === 'ArrowLeft' ? -1 : 1) +
																	workspaceViews.length) %
																	workspaceViews.length
															] ?? 'wheel')
											setMainView(next)
											document.getElementById(`${next}-tab`)?.focus()
										}}
									>
										{view === 'wheel'
											? 'The wheel'
											: view === 'activity'
												? 'Activity'
												: 'Token standings'}
									</button>
								))}
							</div>
							{celebration && (
								<WinnerCelebration
									key={celebration.id}
									winner={celebration.placeName}
									onClose={closeCelebration}
								/>
							)}
							<div
								id="wheel-panel"
								role="tabpanel"
								aria-labelledby="wheel-tab"
								hidden={mainView !== 'wheel'}
							>
								<div className="wheel-wrap">
									<div
										className="pointer"
										aria-hidden="true"
										style={{ color: pointerColor }}
									>
										◀
									</div>
									<div
										ref={wheelRef}
										data-spin-phase={
											liveReveal ? 'live' : spin ? 'replay' : 'settled'
										}
										data-landing-rotation={
											savedResult
												? animationPlan(savedResult).rotation
												: undefined
										}
										className={`wheel ${spin ? 'wheel-spinning' : ''}`}
										data-testid="lunch-wheel"
										style={{
											background: gradient,
											transform: `rotate(${rotation}deg)`,
										}}
										role="img"
										aria-label={
											wheelOptions.length
												? `Wheel with ${wheelOptions.length} lunch places, sized by ${activeReplay ? "today's saved result snapshot replay" : 'live odds for the next scheduled draw'}`
												: 'Empty lunch wheel'
										}
									>
										{wheelOptions.length
											? wheelOptions.map((option, index) => (
													<span
														className="wheel-label"
														key={option.placeId}
														title={option.name}
														style={{
															fontSize:
																option.probability < 0.05
																	? `clamp(10px, ${Math.max(1.8, option.probability * 80)}cqw, 24px)`
																	: undefined,
															transform: `rotate(${(wheelOptions.slice(0, index).reduce((sum, item) => sum + item.probability, 0) + option.probability / 2) * 360}deg) translateY(-28cqw) rotate(-90deg)`,
														}}
													>
														{option.name.length > 14
															? `${option.name.slice(0, 13)}…`
															: option.name}
													</span>
												))
											: null}
									</div>
									<button
										type="button"
										className="wheel-hub"
										disabled={!today?.result || spin || Boolean(celebration)}
										onClick={replayResult}
										aria-label={
											today?.result
												? 'Replay wheel animation'
												: 'Waiting for the scheduled draw'
										}
										title={
											today?.result
												? 'Replay the saved result'
												: 'The next draw runs on the schedule'
										}
									>
										<span aria-hidden="true">{today?.result ? '↻' : '◷'}</span>
									</button>
								</div>
								<div className="wheel-footer">
									<span className="wheel-state">
										{liveReveal
											? 'THE WHEEL IS DECIDING…'
											: activeReplay
												? "REPLAYING TODAY'S RESULT"
												: today?.status === 'skipped'
													? 'ROLL SKIPPED · NEXT DRAW'
													: 'LIVE ODDS FOR NEXT DRAW'}
									</span>
									<strong
										role="status"
										aria-live="polite"
										data-testid="wheel-target"
										data-target-date={
											activeReplay && today?.result
												? today.result.localDate
												: wheelTargetDate
										}
									>
										{liveReveal
											? 'Watch the pointer…'
											: activeReplay && today?.result
												? `Saved pick · ${today.result.localDate}`
												: today?.status === 'skipped'
													? `Roll skipped for an event · next roll ${wheelTargetLabel} at ${today.schedule.time}`
													: wheelTargetLabel
														? `Scheduled for ${wheelTargetLabel} at ${today?.schedule.time ?? ''}`
														: 'Loading schedule'}
									</strong>
									{today?.result && (
										<button
											className="replay-button"
											type="button"
											onClick={replayResult}
											disabled={spin || Boolean(celebration)}
											aria-label="Replay today's result"
										>
											↻ Replay today&apos;s result
										</button>
									)}
								</div>
							</div>
							<div
								id="activity-panel"
								role="tabpanel"
								aria-labelledby="activity-tab"
								hidden={mainView !== 'activity'}
							>
								{mainView === 'activity' && today && (
									<DailyActivity
										participantId={participantId}
										localDate={today.localDate}
										nextDrawDate={
											currentBets?.window.localDate ?? today.wheel.localDate
										}
									/>
								)}
							</div>
							<div
								id="standings-panel"
								role="tabpanel"
								aria-labelledby="standings-tab"
								hidden={mainView !== 'standings'}
							>
								{mainView === 'standings' && (
									<TokenOverview participantId={participantId} />
								)}
							</div>
						</div>
						<div className="wheel-status">
							<Readiness />
							{pollingError && (
								<p className="refresh-error" role="status" aria-live="polite">
									{pollingError}
								</p>
							)}
						</div>
					</section>

					<section
						className="play-grid"
						aria-label="Lunch wheel and member controls"
					>
						<div className="panel roster-panel">
							<div className="section-heading">
								<div>
									<p className="eyebrow">01 / YOUR SEAT AT THE TABLE</p>
								</div>
								<span className="mini-icon">↗</span>
							</div>
							<div className="member-status">
								<div>
									<span className="status-label">YOU ARE</span>
									<strong>{currentName ?? 'No one yet'}</strong>
								</div>
								<div className="balance">
									<span className="status-label">YOUR TOKENS</span>
									<strong>
										{wallet?.balance ?? '—'} <span>✳</span>
									</strong>
								</div>
							</div>
							{displayedAttendance?.checkedIn && (
								<p
									ref={checkInConfirmation}
									tabIndex={-1}
									className="check-in-confirmation"
									data-testid="check-in-confirmation"
									role="status"
									aria-live="polite"
								>
									Checked in for today.
								</p>
							)}
							<div className="button-row">
								<button
									type="button"
									className="button button-yellow"
									data-testid="check-in"
									aria-haspopup="dialog"
									disabled={busy || !participantId || !canCheckIn}
									onClick={(event) => {
										const result = today?.result
										if (!result) return
										if (checkInConfirmed.current) {
											checkInConfirmed.current = false
											if (checkInSubmitting.current) return
											checkInSubmitting.current = true
											void mutate(
												'/attendance',
												{ drawId: result.id },
												`Check-in complete — ${currentEconomy.attendanceReward} tokens added.`,
											)
												.then((confirmed) => {
													if (confirmed) {
														setCheckInConfirmOpen(false)
														window.setTimeout(
															() => checkInConfirmation.current?.focus(),
															0,
														)
													}
												})
												.finally(() => {
													checkInSubmitting.current = false
												})
											return
										}
										setError('')
										checkInTrigger.current = event.currentTarget
										setCheckInConfirmOpen(true)
									}}
								>
									{displayedAttendance?.checkedIn ? (
										'Checked in'
									) : (
										<>
											Check in <span>+{currentEconomy.attendanceReward} ✳</span>
										</>
									)}
								</button>
								<button
									type="button"
									className="button button-light"
									disabled={
										pushBusy ||
										!participantId ||
										(!pushOn && (!pushConfigLoaded || !pushPublicKey)) ||
										(!pushOn &&
											(typeof window === 'undefined' ||
												!('Notification' in window) ||
												!('serviceWorker' in navigator) ||
												!('PushManager' in window)))
									}
									onClick={() =>
										pushOn ? void disablePush() : void togglePush()
									}
									data-testid="push-opt-in"
								>
									{pushBusy
										? 'Updating alerts…'
										: pushOn
											? 'Turn alerts off'
											: 'Get lunch and token alerts'}
								</button>
							</div>
							{pushConfigLoaded && !pushPublicKey && !pushOn && (
								<p className="check-in-pledge">
									Lunch and token alerts are not configured yet.
								</p>
							)}
							<TokenTransfer
								key={participantId}
								participantId={participantId}
								participants={participants}
								balance={wallet?.balance ?? 0}
								busy={busy}
								onSend={(body, message) => mutate('/transfers', body, message)}
							/>
						</div>

						<section
							className="panel betting-card"
							aria-labelledby="betting-heading"
						>
							<div className="section-heading">
								<div>
									<p className="eyebrow">YOUR TOKENS, YOUR CALL</p>
									<h2 id="betting-heading">Bet on lunch</h2>
								</div>
								<span className="betting-mark" aria-hidden="true">
									✳
								</span>
							</div>
							{!currentBets ? (
								<p className="empty-note" role={betError ? 'alert' : 'status'}>
									{betError || 'Loading betting window…'}
								</p>
							) : (
								<>
									<p className="muted">
										{betWindowOpen
											? `Bet on ${currentBets.window.localDate}. Changes close ${currentBets.window.cutoffLocalDate} at ${currentBets.window.cutoffLocalTime} (${currentBets.window.timezone}).`
											: wheelActivityPaused
												? wheelPauseMessage
												: `Betting for ${currentBets.window.localDate} is closed.`}
									</p>
									<form
										className="bet-form"
										onSubmit={(event) => void saveBet(event)}
									>
										<label>
											Lunch place
											<select
												value={betPlaceDraft}
												onChange={(event) =>
													setBetPlaceDraft(event.target.value)
												}
												disabled={
													betBusy || !betWindowOpen || !today?.odds.length
												}
											>
												<option value="">Choose a place</option>
												{(today?.odds ?? []).map((option) => (
													<option key={option.placeId} value={option.placeId}>
														{option.name}
													</option>
												))}
											</select>
										</label>
										<label>
											Stake
											<span className="bet-stake-field">
												<input
													type="number"
													min="1"
													max={Math.min(
														2147483647,
														(wallet?.balance ?? 0) +
															(currentBets.bet?.stake ?? 0),
													)}
													step="1"
													inputMode="numeric"
													value={betStakeDraft}
													onChange={(event) =>
														setBetStakeDraft(event.target.value)
													}
													disabled={betBusy || !betWindowOpen}
													aria-describedby="bet-balance-help"
												/>
												<span>tokens</span>
											</span>
										</label>
										<p className="bet-balance-help" id="bet-balance-help">
											Available: {wallet?.balance ?? '—'} tokens
											{currentBets.bet
												? ` · ${currentBets.bet.stake} reserved on your current bet`
												: ''}
										</p>
										{(() => {
											const probability = today?.odds.find(
												(option) => option.placeId === betPlaceDraft,
											)?.probability
											const stake = Number(betStakeDraft)
											const gross =
												probability !== undefined &&
												probability > 0 &&
												Number.isSafeInteger(stake) &&
												stake > 0
													? Math.min(
															2147483647,
															Math.floor(stake / probability),
														)
													: null
											return (
												<div className="bet-estimate" aria-live="polite">
													<div>
														<span>Odds</span>
														<strong>
															{probability === undefined
																? '—'
																: approximateOdds(probability)}
														</strong>
													</div>
													<div>
														<span>Est. return if it wins</span>
														<strong>
															{gross === null
																? '—'
																: `${gross.toLocaleString()} tokens`}
														</strong>
													</div>
													<div>
														<span>Est. net gain</span>
														<strong>
															{gross === null
																? '—'
																: `${(gross - stake).toLocaleString()} tokens`}
														</strong>
													</div>
												</div>
											)
										})()}
										<div className="bet-actions">
											<button
												className="button button-yellow"
												type="submit"
												disabled={
													betBusy ||
													!participantId ||
													!betWindowOpen ||
													!today?.odds.length ||
													!betPlaceDraft ||
													!Number.isSafeInteger(Number(betStakeDraft)) ||
													Number(betStakeDraft) < 1 ||
													Number(betStakeDraft) >
														(wallet?.balance ?? 0) +
															(currentBets.bet?.stake ?? 0)
												}
											>
												{betBusy
													? 'Saving…'
													: currentBets.bet
														? 'Update bet'
														: 'Place bet'}
											</button>
											{currentBets.bet && (
												<button
													className="button button-light"
													type="button"
													onClick={() => void cancelBet()}
													disabled={betBusy || !betWindowOpen}
												>
													Cancel bet
												</button>
											)}
										</div>
									</form>
								</>
							)}
							{betError && (
								<p className="bet-message bet-error" role="alert">
									{betError}
								</p>
							)}
							{betNotice && (
								<p className="bet-message" role="status" aria-live="polite">
									{betNotice}
								</p>
							)}
							{currentBets?.bet && (
								<p className="current-bet-note">
									Current bet:{' '}
									<strong>
										{currentBets.bet.stake} tokens on{' '}
										{currentBets.bet.placeName}
									</strong>
								</p>
							)}
						</section>

						<div className="panel odds-panel">
							<div className="section-heading">
								<div>
									<p className="eyebrow">02 / THE ODDS</p>
									<h2>Lunch spot</h2>
								</div>
								<span className="odds-total">{odds.length} PLACES</span>
							</div>
							<p className="muted">Current chances for the next draw.</p>
							{influenceError && (
								<p className="refresh-error" role="status">
									{influenceError}{' '}
									<button
										className="ledger-toggle"
										type="button"
										onClick={() =>
											void refresh(participantId).catch(() => undefined)
										}
									>
										Retry positions
									</button>
								</p>
							)}
							<fieldset
								className="odds-format-toggle"
								aria-label="Choose how restaurant odds are shown"
							>
								<button
									type="button"
									aria-pressed={!showFairOdds}
									onClick={() => setShowFairOdds(false)}
								>
									Chances
								</button>
								<button
									type="button"
									aria-pressed={showFairOdds}
									onClick={() => setShowFairOdds(true)}
								>
									Odds
								</button>
							</fieldset>
							{wheelActivityPaused && (
								<p className="muted" role="status">
									{wheelPauseMessage}
								</p>
							)}
							<div className="odds-list">
								{odds.map((option, index) => {
									const placeId = 'placeId' in option ? option.placeId : ''
									const fairOdds = approximateOdds(option.probability)
									const influencePosition = currentInfluence?.places.find(
										(position) => position.placeId === placeId,
									)
									return (
										<div className="odds-row" key={placeId}>
											<span
												className="odds-color"
												style={{
													background: wheelColors[index % wheelColors.length],
												}}
											/>
											<InfluenceControls
												placeId={placeId}
												placeName={option.name}
												healthLevel={option.healthLevel}
												position={influencePosition}
												window={currentInfluence?.window ?? null}
												balance={wallet?.balance ?? 0}
												boostCost={currentEconomy.boostCost}
												reduceCost={currentEconomy.reduceCost}
												busy={busy || influenceBusy || Boolean(influenceError)}
												identityReady={
													Boolean(participantId) && !wheelActivityPaused
												}
												onChange={changeInfluence}
												onRefund={refundSpot}
											/>
											<span className="odds-bar">
												<span
													style={{
														width: `${Math.max(option.probability * 100, option.probability > 0 ? 0.5 : 0)}%`,
														background: wheelColors[index % wheelColors.length],
													}}
												/>
											</span>
											<strong
												title={`${(option.probability * 100).toPrecision(6)}% chance. Odds show approximate net winnings per token staked; payouts use the exact final chance.`}
											>
												{showFairOdds
													? fairOdds
													: `${(option.probability * 100).toFixed(1)}%`}
											</strong>
											<div className="influence-buttons">
												<button
													type="button"
													className="remove-place-control"
													aria-label={`Banish ${option.name} from the wheel for ${currentEconomy.removePlaceCost} tokens`}
													title={`Banish ${option.name} for ${currentEconomy.removePlaceCost} tokens`}
													disabled={
														busy || !participantId || wheelActivityPaused
													}
													onClick={() => {
														if (
															window.confirm(
																`Banish ${option.name} from the wheel for ${currentEconomy.removePlaceCost} tokens? This is final for this restaurant; pending boosts, reductions, and bets will be refunded. You can restore it later by adding the same name.`,
															)
														)
															void mutate(
																'/purchases',
																{ placeId, action: 'remove' },
																'Restaurant banished.',
															)
													}}
												>
													×
												</button>
											</div>
										</div>
									)
								})}
								{!odds.length && (
									<p className="empty-note">
										The admin can add places to get the wheel rolling.
									</p>
								)}
							</div>
							<form
								className="add-place"
								onSubmit={(event) => {
									event.preventDefault()
									const form = event.currentTarget
									const input = new FormData(form)
										.get('place')
										?.toString()
										.trim()
									if (input)
										void mutate(
											'/places',
											{
												name: input,
												healthLevel: new FormData(form).get('healthLevel'),
											},
											`New lunch place added for ${currentEconomy.addPlaceCost} tokens.`,
										).then((saved) => {
											if (saved) form.reset()
										})
								}}
							>
								<label htmlFor="place-name">Have a new spot in mind?</label>
								<div className="inline-form">
									<input
										id="place-name"
										name="place"
										placeholder={`Add a lunch place · ${currentEconomy.addPlaceCost} tokens`}
										maxLength={100}
										required
										disabled={!participantId || busy || wheelActivityPaused}
									/>
									<button
										type="submit"
										className="button button-light"
										disabled={!participantId || busy || wheelActivityPaused}
									>
										Add place
									</button>
									<HealthSelect
										label="New spot health level"
										disabled={!participantId || busy || wheelActivityPaused}
									/>
								</div>
							</form>
						</div>
						<div className="panel token-activity-panel">
							<div className="ledger">
								<div className="ledger-heading">
									<h3>Recent token activity</h3>
					{wallet &&
					combineInfluenceEntries(wallet.ledger).length > 5 ? (
										<button
											type="button"
											className="ledger-toggle"
											aria-expanded={showAllLedger}
											aria-controls="token-ledger"
											onClick={() => setShowAllLedger((showing) => !showing)}
										>
											{showAllLedger ? 'Show recent' : 'Show all'}
										</button>
									) : (
										<span>YOUR WALLET</span>
									)}
								</div>
								{wallet?.ledger.length ? (
									<div id="token-ledger">
										{combineInfluenceEntries(wallet.ledger)
											.slice(0, showAllLedger ? undefined : 5)
											.map((entry) => (
												<div className="ledger-row" key={entry.id}>
													<TokenEntryDescription entry={entry} />
													<span className="ledger-date">
														<time dateTime={entry.createdAt}>
															{new Intl.DateTimeFormat(undefined, {
																dateStyle: 'short',
																timeStyle: 'short',
																timeZone: today?.schedule.timezone ?? 'UTC',
															}).format(new Date(entry.createdAt))}
														</time>
													</span>
													<strong className={entry.delta > 0 ? 'positive' : ''}>
														{moneyLabel(entry.delta)}
													</strong>
												</div>
											))}
									</div>
								) : (
									<p className="empty-note">
										Your token activity will show up here.
									</p>
								)}
							</div>
							<WalletBets bets={wallet?.bets ?? []} />
							<TeamActivity
								participants={participants}
								currentParticipantId={participantId}
								timezone={today?.schedule.timezone ?? 'UTC'}
							/>
							{currentBets?.recent.length ? (
								<section
									className="bet-history"
									aria-label="Recent bet activity"
								>
									<h3>Recent bets</h3>
									{currentBets.recent.map((bet) => (
										<div className="bet-history-row" key={bet.id}>
											<span>
												<strong>{bet.placeName}</strong>
												<small>
													{bet.localDate} · {bet.stake} tokens · {bet.status}
												</small>
											</span>
											<b>{bet.payout === null ? '—' : `+${bet.payout} ✳`}</b>
										</div>
									))}
								</section>
							) : null}
						</div>
					</section>
				</>
			)}
			{(entryStage === 'name' || entryStage === 'game') && (
				<details className="admin-disclosure" id="admin" ref={adminDisclosure}>
					<summary>Admin tools</summary>
					<section className="admin-section">
						<div className="admin-intro">
							<p className="eyebrow">THE BACK OFFICE</p>
							<h2>Admin corner</h2>
							<p>Keep the roster, lunch spots and schedule in good order.</p>
						</div>
						{!admin ? (
							<form className="admin-login" onSubmit={login}>
								<label htmlFor="admin-password">Administrator password</label>
								<div className="inline-form">
									<input
										id="admin-password"
										type="password"
										value={adminPassword}
										onChange={(event) => setAdminPassword(event.target.value)}
										autoComplete="current-password"
									/>
									<button
										type="submit"
										className="button button-dark"
										disabled={busy || !adminPassword}
									>
										Unlock
									</button>
								</div>
							</form>
						) : (
							<div className="admin-tools">
								<div className="admin-tool-card admin-wide-card" tabIndex={-1}>
									<h3>People</h3>
									<p className="muted">
										Add people, disable or restore access, and set each balance
										with a reason. Balance changes are saved in the person’s
										token history.
									</p>
									<form
										className="inline-form admin-add-person"
										onSubmit={(event) => {
											event.preventDefault()
											if (newName.trim())
												void adminSave(
													'/admin/participants',
													'POST',
													{ name: newName },
													'Person added.',
												).then(() => setNewName(''))
										}}
									>
										<input
											aria-label="New team member name"
											placeholder="New team member"
											value={newName}
											onChange={(event) => setNewName(event.target.value)}
											maxLength={100}
										/>
										<button
											type="submit"
											className="button button-light"
											disabled={busy || !newName.trim()}
										>
											Add person
										</button>
									</form>
									<div className="admin-table-scroll">
										<table className="admin-data-table people-table">
											<thead>
												<tr>
													<th scope="col">Person</th>
													<th scope="col">Status</th>
													<th scope="col">Balance</th>
													<th scope="col">Set balance</th>
													<th scope="col">Reason</th>
													<th scope="col">Actions</th>
												</tr>
											</thead>
											<tbody>
												{allParticipants.map((person) => {
													const draft = balanceDrafts[person.id] ?? {
														balance: String(tokenBalances[person.id] ?? 0),
														reason: '',
													}
													return (
														<tr key={person.id}>
															<td>
																{editingPersonId === person.id ? (
																	<form
																		className="inline-form"
																		onSubmit={(event) => {
																			event.preventDefault()
																			void adminSave(
																				`/admin/participants/${person.id}`,
																				'PATCH',
																				{ name: editingPersonName },
																				'Name updated.',
																			).then(() => setEditingPersonId(''))
																		}}
																	>
																		<input
																			aria-label={`Rename ${person.name}`}
																			value={editingPersonName}
																			onChange={(event) =>
																				setEditingPersonName(event.target.value)
																			}
																			maxLength={100}
																		/>
																		<button
																			type="submit"
																			className="button button-light"
																			disabled={
																				busy || !editingPersonName.trim()
																			}
																		>
																			Save
																		</button>
																	</form>
																) : (
																	<strong>{person.name}</strong>
																)}
															</td>
															<td>
																<span
																	className={
																		person.active
																			? 'status-active'
																			: 'status-inactive'
																	}
																>
																	{person.active ? 'Active' : 'Disabled'}
																</span>
															</td>
															<td>{tokenBalances[person.id] ?? 0} ✳</td>
															<td>
																<input
																	aria-label={`${person.name} new token balance`}
																	className="table-input"
																	type="number"
																	min={0}
																	max={2147483647}
																	step={1}
																	required
																	value={draft.balance}
																	onChange={(event) =>
																		setBalanceDrafts({
																			...balanceDrafts,
																			[person.id]: {
																				...draft,
																				balance: event.target.value,
																			},
																		})
																	}
																/>
															</td>
															<td>
																<input
																	aria-label={`Reason for ${person.name} balance`}
																	className="table-input reason-input"
																	maxLength={500}
																	required
																	value={draft.reason}
																	onChange={(event) =>
																		setBalanceDrafts({
																			...balanceDrafts,
																			[person.id]: {
																				...draft,
																				reason: event.target.value,
																			},
																		})
																	}
																/>
															</td>
															<td>
																<div className="table-actions">
																	<button
																		type="button"
																		className="button button-light"
																		disabled={
																			busy ||
																			!draft.reason.trim() ||
																			!Number.isSafeInteger(
																				Number(draft.balance),
																			) ||
																			Number(draft.balance) ===
																				tokenBalances[person.id]
																		}
																		onClick={() =>
																			void adminSave(
																				'/admin/token-balances',
																				'POST',
																				{
																					participantId: person.id,
																					balance: Number(draft.balance),
																					reason: draft.reason,
																				},
																				`Balance set for ${person.name}.`,
																			)
																		}
																	>
																		Set
																	</button>
																	<button
																		type="button"
																		className="quiet-link"
																		disabled={busy}
																		onClick={() => {
																			setEditingPersonId(person.id)
																			setEditingPersonName(person.name)
																		}}
																	>
																		Rename
																	</button>
																	<button
																		type="button"
																		className="quiet-link"
																		disabled={busy}
																		onClick={() =>
																			void adminSave(
																				`/admin/participants/${person.id}`,
																				'PATCH',
																				{ active: !person.active },
																				person.active
																					? 'Person disabled.'
																					: 'Person restored.',
																			)
																		}
																	>
																		{person.active ? 'Disable' : 'Restore'}
																	</button>
																	<button
																		type="button"
																		ref={removeTrigger}
																		className="quiet-link"
																		aria-label={`Remove ${person.name}`}
																		disabled={busy}
																		onClick={(event) => {
																			removeTrigger.current =
																				event.currentTarget
																			setRemoveTarget(person)
																		}}
																	>
																		Remove
																	</button>
																</div>
															</td>
														</tr>
													)
												})}
											</tbody>
										</table>
									</div>
								</div>
								<div
									className="admin-tool-card admin-wide-card"
									data-testid="admin-restaurant-odds"
								>
									<h3>Places and odds</h3>
									<form
										className="inline-form place-create-form"
										onSubmit={(event) => {
											event.preventDefault()
											const name = new FormData(event.currentTarget)
												.get('admin-place')
												?.toString()
												.trim()
											if (name)
												void adminSave(
													'/admin/places',
													'POST',
													{
														name,
														healthLevel: new FormData(event.currentTarget).get(
															'healthLevel',
														),
													},
													'Place added.',
												)
										}}
									>
										<input
											name="admin-place"
											aria-label="New lunch place"
											placeholder="New lunch place"
											maxLength={100}
										/>
										<button
											type="submit"
											className="button button-light"
											disabled={busy}
										>
											Add
										</button>
										<HealthSelect
											label="New admin place health level"
											disabled={busy}
										/>
									</form>
									<p className="muted">
										Adjust one restaurant&apos;s share with its slider or
										percentage field. The remaining shares resize proportionally
										and stay positive, keeping the total at 100%. Saving changes
										future draws and keeps completed results as they were.
										Saving percentages or a direct weight refunds pending
										influence first. Weights are relative: doubling a weight
										doubles its share relative to unchanged weights.
									</p>
									{restaurantOdds.length ? (
										<>
											<div className="odds-equalizer">
												<button
													className="button button-light"
													type="button"
													disabled={busy}
													onClick={() =>
														setRestaurantOddsDraft(
															equalRestaurantOddsDraft(restaurantOdds),
														)
													}
												>
													Set equal odds · 1 in {restaurantOdds.length} each
												</button>
												<span>
													Each chance is about{' '}
													{(100 / restaurantOdds.length).toFixed(6)}%. This
													updates the draft; save to apply it.
												</span>
											</div>
											<div className="odds-selection-actions">
												<button
													className="button button-light"
													type="button"
													disabled={busy || selectedOddsCount === 0}
													onClick={() => {
														if (!selectedOddsCount) return
														setRestaurantOddsDraft(
															equalizeSelectedRestaurantOddsDraft(
																restaurantOdds,
																restaurantOddsDraft,
																selectedOddsPlaceIds,
															),
														)
													}}
												>
													Equalize selected ({selectedOddsCount})
												</button>
												<span aria-live="polite">
													{selectedOddsCount
														? `${selectedOddsCount} selected · each receives about ${(100 / restaurantOdds.length).toFixed(6)}%; other shares keep their ratios.`
														: 'Select restaurants to set them to the overall average chance.'}
												</span>
											</div>
											<div className="admin-table-scroll">
												<table className="admin-data-table odds-table">
													<thead>
														<tr>
															<th scope="col">Select</th>
															<th scope="col">Restaurant</th>
															<th scope="col">Current wheel share</th>
															<th scope="col">Weight</th>
															<th scope="col">Place settings</th>
														</tr>
													</thead>
													<tbody>
														{restaurantOdds.map((place) => {
															const detail = places.find(
																(item) => item.id === place.placeId,
															)
															const minimumPercent =
																restaurantOdds.length === 1
																	? 100
																	: minimumOddsPercent
															const maximumPercent =
																restaurantOdds.length === 1
																	? 100
																	: 100 -
																		minimumOddsPercent *
																			(restaurantOdds.length - 1)
															const draftPercent = Number(
																restaurantOddsDraft[place.placeId],
															)
															const sliderPercent = Math.min(
																maximumPercent,
																Math.max(
																	minimumPercent,
																	Number.isFinite(draftPercent) &&
																		draftPercent > 0
																		? draftPercent
																		: minimumPercent,
																),
															)
															return (
																<tr
																	key={place.placeId}
																	className="restaurant-row"
																>
																	<td className="odds-select-cell">
																		<input
																			type="checkbox"
																			aria-label={`Select ${place.name} for equalization`}
																			checked={selectedOddsPlaceIds.includes(
																				place.placeId,
																			)}
																			disabled={busy}
																			onChange={(event) =>
																				setSelectedOddsPlaceIds((selected) =>
																					event.target.checked
																						? [...selected, place.placeId]
																						: selected.filter(
																								(placeId) =>
																									placeId !== place.placeId,
																							),
																				)
																			}
																		/>
																	</td>
																	<th scope="row">
																		{detail ? (
																			<PlaceNameControl
																				place={detail}
																				editing={editingPlaceId === detail.id}
																				name={editingPlaceName}
																				busy={busy}
																				onChange={setEditingPlaceName}
																				onSave={() =>
																					adminSave(
																						`/admin/places/${detail.id}`,
																						'PATCH',
																						{ name: editingPlaceName },
																						'Name updated.',
																					).then(() => setEditingPlaceId(''))
																				}
																			/>
																		) : (
																			place.name
																		)}
																	</th>
																	<td>
																		<div className="odds-editor">
																			<input
																				className="odds-range"
																				aria-label={`${place.name} wheel share slider`}
																				type="range"
																				min={minimumPercent}
																				max={maximumPercent}
																				step="0.01"
																				value={sliderPercent}
																				disabled={restaurantOdds.length === 1}
																				onChange={(event) =>
																					updateRestaurantOdds(
																						place.placeId,
																						event.target.value,
																					)
																				}
																			/>
																			<label className="odds-input-label">
																				<input
																					className="table-input odds-input"
																					aria-label={`${place.name} percentage`}
																					type="number"
																					min={minimumPercent}
																					max={maximumPercent}
																					step="0.000001"
																					required
																					disabled={restaurantOdds.length === 1}
																					value={
																						restaurantOddsDraft[
																							place.placeId
																						] ?? ''
																					}
																					onChange={(event) =>
																						updateRestaurantOdds(
																							place.placeId,
																							event.target.value,
																						)
																					}
																				/>{' '}
																				<span>%</span>
																			</label>
																		</div>
																	</td>
																	<td>
																		<form
																			className="weight-editor"
																			onSubmit={(event) => {
																				event.preventDefault()
																				void adminSave(
																					'/admin/place-weights',
																					'PUT',
																					{
																						placeId: place.placeId,
																						weight: Number(
																							weightDrafts[place.placeId],
																						),
																					},
																					'Restaurant weight saved.',
																				)
																			}}
																		>
																			<input
																				className="table-input"
																				type="number"
																				step="any"
																				min="5e-324"
																				required
																				aria-label={`${place.name} weight`}
																				value={
																					weightDrafts[place.placeId] ?? ''
																				}
																				placeholder="Outside display range"
																				title={
																					detail
																						? `Stored log weight: ${detail.logWeight}. Enter a positive weight; other weights retain their values after pending refunds.`
																						: ''
																				}
																				onChange={(event) =>
																					setWeightDrafts({
																						...weightDrafts,
																						[place.placeId]: event.target.value,
																					})
																				}
																			/>
																			<button
																				type="submit"
																				className="button button-light"
																				disabled={
																					busy ||
																					(detail !== undefined &&
																						weightDrafts[place.placeId] ===
																							weightInput(detail.logWeight)) ||
																					!Number.isFinite(
																						Number(weightDrafts[place.placeId]),
																					) ||
																					Number(weightDrafts[place.placeId]) <=
																						0
																				}
																			>
																				Save weight
																			</button>
																		</form>
																	</td>
																	<td>
																		{detail && (
																			<PlaceActionControls
																				place={detail}
																				busy={busy}
																				onRename={() => {
																					setEditingPlaceId(detail.id)
																					setEditingPlaceName(detail.name)
																				}}
																				onUpdate={(body, notice) =>
																					adminSave(
																						`/admin/places/${detail.id}`,
																						'PATCH',
																						body,
																						notice,
																					)
																				}
																			/>
																		)}
																	</td>
																</tr>
															)
														})}
													</tbody>
												</table>
											</div>
											<div className="odds-save-row">
												<span aria-live="polite">
													Total:{' '}
													{Number.isFinite(restaurantOddsTotal)
														? restaurantOddsTotal.toFixed(4)
														: '—'}
													%
												</span>
												<button
													type="button"
													className="button button-dark"
													disabled={busy || !restaurantOddsAreValid}
													onClick={() =>
														void adminSave(
															'/admin/restaurant-odds',
															'PUT',
															{
																places: restaurantOdds.map(({ placeId }) => ({
																	placeId,
																	percent: Number(restaurantOddsDraft[placeId]),
																})),
															},
															'Restaurant odds saved.',
														)
													}
												>
													Save percentages
												</button>
											</div>
										</>
									) : (
										<p className="muted">
											Add an active restaurant to set wheel percentages.
										</p>
									)}
									{places.some((place) => !place.active) && (
										<details className="archived-places">
											<summary>
												Archived places (
												{places.filter((place) => !place.active).length})
											</summary>
											{places
												.filter((place) => !place.active)
												.map((place) => (
													<div className="admin-row" key={place.id}>
														{
															<PlaceNameControl
																place={place}
																editing={editingPlaceId === place.id}
																name={editingPlaceName}
																busy={busy}
																onChange={setEditingPlaceName}
																onSave={() =>
																	adminSave(
																		`/admin/places/${place.id}`,
																		'PATCH',
																		{ name: editingPlaceName },
																		'Name updated.',
																	).then(() => setEditingPlaceId(''))
																}
															/>
														}
														{
															<PlaceActionControls
																place={place}
																busy={busy}
																onRename={() => {
																	setEditingPlaceId(place.id)
																	setEditingPlaceName(place.name)
																}}
																onUpdate={(body, notice) =>
																	adminSave(
																		`/admin/places/${place.id}`,
																		'PATCH',
																		body,
																		notice,
																	)
																}
															/>
														}
													</div>
												))}
										</details>
									)}
								</div>
								<div className="admin-tool-card">
									<h3>Draw schedule</h3>
									<p className="muted">
										Changing the schedule refunds any open bets so they are not
										silently moved to a different draw, and clears a pending
										one-time skip.
									</p>
									<form
										onSubmit={(event) => {
											event.preventDefault()
											void adminSave(
												'/admin/schedule',
												'PUT',
												schedule,
												'Schedule saved.',
											)
										}}
									>
										<label>
											Time
											<input
												type="time"
												value={schedule.time}
												onChange={(event) =>
													setSchedule({ ...schedule, time: event.target.value })
												}
											/>
										</label>
										<label>
											Timezone
											<input
												value={schedule.timezone}
												onChange={(event) =>
													setSchedule({
														...schedule,
														timezone: event.target.value,
													})
												}
											/>
										</label>
										<div className="weekdays">
											{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
												(day, index) => {
													const weekday = index + 1
													return (
														<label key={day}>
															<input
																type="checkbox"
																checked={schedule.weekdays.includes(weekday)}
																onChange={(event) =>
																	setSchedule({
																		...schedule,
																		weekdays: event.target.checked
																			? [...schedule.weekdays, weekday].sort()
																			: schedule.weekdays.filter(
																					(day) => day !== weekday,
																				),
																	})
																}
															/>
															{day[0]}
														</label>
													)
												},
											)}
										</div>
										<button
											type="submit"
											className="button button-dark"
											disabled={busy || !schedule.weekdays.length}
										>
											Save schedule
										</button>
									</form>
									<div data-testid="admin-draw-skip">
										<p className="muted">
											{drawSkip.localDate
												? `The roll scheduled for ${drawSkip.localDate} is marked to be skipped. Any open bets on it have been refunded.`
												: 'Use this for an office event or another day when the team will not be drawing lunch.'}
										</p>
										<div className="inline-form">
											<button
												className="button button-light"
												type="button"
												disabled={busy || Boolean(drawSkip.localDate)}
												onClick={() =>
													void adminSave(
														'/admin/draw-skip',
														'PUT',
														{ skip: true },
														'The next scheduled roll will be skipped.',
													)
												}
											>
												{drawSkip.localDate ? 'Skip set' : 'Skip next roll'}
											</button>
											{drawSkip.localDate && (
												<button
													className="button button-dark"
													type="button"
													disabled={busy || !drawSkip.cancellable}
													onClick={() =>
														void adminSave(
															'/admin/draw-skip',
															'PUT',
															{ skip: false },
															'The pending roll skip was cancelled.',
														)
													}
												>
													Undo skip
												</button>
											)}
										</div>
									</div>
								</div>
								<div
									className="admin-tool-card"
									data-testid="admin-preferences"
								>
									<h3>Wheel, check-in, betting and eligibility</h3>
									<form
										onSubmit={(event) => {
											event.preventDefault()
											void adminSave(
												'/admin/preferences',
												'PUT',
												preferences,
												'Wheel, check-in, betting and eligibility preferences saved.',
											)
										}}
									>
										<label>
											Wheel spin duration (seconds)
											<input
												type="number"
												min={5}
												max={60}
												step={1}
												required
												value={preferences.wheelSpinSeconds}
												onChange={(event) =>
													setPreferences({
														...preferences,
														wheelSpinSeconds: Number(event.target.value),
													})
												}
											/>
										</label>
										<p className="muted">
											5–60 seconds. Applies to future draws; saved results keep
											their original spin.
										</p>
										<label>
											Close betting this many minutes before the draw
											<input
												type="number"
												required
												min={0}
												max={1440}
												step={1}
												value={preferences.bettingCloseMinutes}
												onChange={(event) =>
													setPreferences({
														...preferences,
														bettingCloseMinutes: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Reopen activity this many minutes after the roll
											<input
												type="number"
												required
												min={0}
												max={1440}
												step={1}
												value={preferences.postDrawDelayMinutes}
												onChange={(event) =>
													setPreferences({
														...preferences,
														postDrawDelayMinutes: Number(event.target.value),
													})
												}
											/>
										</label>
										<p className="muted">
											0 opens boosts, reductions, bets and place purchases
											immediately after the roll.
										</p>
										<label>
											Maximum restaurant walk (minutes)
											<input
												type="number"
												required
												min={1}
												max={120}
												step={1}
												value={preferences.maxWalkMinutes}
												onChange={(event) =>
													setPreferences({
														...preferences,
														maxWalkMinutes: Number(event.target.value),
													})
												}
											/>
										</label>
										<p className="muted">
											The Help view shows this walking limit as a venue
											eligibility requirement. The team checks walking times.
										</p>
										<label>
											Other venue eligibility requirements (one per line)
											<textarea
												value={preferences.venueEligibilityCriteria}
												maxLength={2000}
												rows={4}
												required
												onChange={(event) =>
													setPreferences({
														...preferences,
														venueEligibilityCriteria: event.target.value,
													})
												}
											/>
										</label>
										<p className="muted">
											These requirements appear in Help. The team checks them;
											the app does not verify venue details automatically.
										</p>
										<label>
											Check-in pledge
											<input
												type="text"
												value={preferences.checkInPledge}
												maxLength={500}
												onChange={(event) =>
													setPreferences({
														...preferences,
														checkInPledge: event.target.value,
													})
												}
											/>
										</label>
										<button
											type="submit"
											className="button button-dark"
											disabled={
												busy ||
												!preferences.checkInPledge.trim() ||
												!preferences.venueEligibilityCriteria.trim()
											}
										>
											Save preferences
										</button>
									</form>
								</div>
								<div
									className="admin-tool-card"
									data-testid="admin-health-rule"
								>
									<h3>Health balance</h3>
									<p>
										After a Treat place wins, boost every active Healthy place
										for future draws. Balanced places do not trigger or receive
										the bonus. Existing places start Balanced.
									</p>
									<form
										onSubmit={(event) => {
											event.preventDefault()
											void adminSave(
												'/admin/health-rule',
												'PUT',
												healthRule,
												'Health balance rule saved.',
											)
										}}
									>
										<label>
											<input
												type="checkbox"
												checked={healthRule.enabled}
												onChange={(event) =>
													setHealthRule({
														...healthRule,
														enabled: event.target.checked,
													})
												}
											/>{' '}
											Enable health balance bonus
										</label>
										<label>
											Healthy place weight multiplier
											<input
												type="number"
												min="1.01"
												max="100"
												step="0.01"
												required
												value={healthRule.multiplier}
												onChange={(event) =>
													setHealthRule({
														...healthRule,
														multiplier: Number(event.target.value),
													})
												}
											/>
										</label>
										<p className="muted">
											×1.25 means 25% more weight, not 25 percentage points.
											Changes apply to future draws; past bonuses remain.
										</p>
										<button
											type="submit"
											className="button button-light"
											disabled={busy}
										>
											Save health rule
										</button>
									</form>
								</div>
								<div className="admin-tool-card" data-testid="admin-economy">
									<h3>Tokens and odds</h3>
									<p className="muted">
										Token costs and rewards apply to future actions. Boost and
										reduce multiply a place&apos;s relative weight for future
										draws; they do not change a saved result.
									</p>
									<form
										onSubmit={(event) => {
											event.preventDefault()
											void adminSave(
												'/admin/economy',
												'PUT',
												economy,
												'Token settings saved.',
											)
										}}
									>
										<label>
											Attendance reward (tokens)
											<input
												type="number"
												required
												min={1}
												max={2147483647}
												step={1}
												value={economy.attendanceReward}
												onChange={(event) =>
													setEconomy({
														...economy,
														attendanceReward: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Add place cost (tokens)
											<input
												type="number"
												required
												min={1}
												max={2147483647}
												step={1}
												value={economy.addPlaceCost}
												onChange={(event) =>
													setEconomy({
														...economy,
														addPlaceCost: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Banish place cost (tokens)
											<input
												type="number"
												required
												min={1}
												max={2147483647}
												step={1}
												value={economy.removePlaceCost}
												onChange={(event) =>
													setEconomy({
														...economy,
														removePlaceCost: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											New restaurant starting weight vs current average
											<input
												type="number"
												required
												min={0.01}
												max={100}
												step="any"
												value={economy.newPlaceMultiplier}
												onChange={(event) =>
													setEconomy({
														...economy,
														newPlaceMultiplier: Number(event.target.value),
													})
												}
											/>
										</label>
										<p className="muted economy-help">
											The multiplier sets a new restaurant&apos;s starting
											weight relative to the current average. Re-adding a
											banished name uses this setting.
										</p>
										<label>
											Boost cost (tokens)
											<input
												type="number"
												required
												min={1}
												max={2147483647}
												step={1}
												value={economy.boostCost}
												onChange={(event) =>
													setEconomy({
														...economy,
														boostCost: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Reduce cost (tokens)
											<input
												type="number"
												required
												min={1}
												max={2147483647}
												step={1}
												value={economy.reduceCost}
												onChange={(event) =>
													setEconomy({
														...economy,
														reduceCost: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Boost relative-weight multiplier
											<input
												type="number"
												required
												min={1.0000000000000002}
												max={100}
												step="any"
												value={economy.boostMultiplier}
												onChange={(event) =>
													setEconomy({
														...economy,
														boostMultiplier: Number(event.target.value),
													})
												}
											/>
										</label>
										<label>
											Reduce relative-weight multiplier
											<input
												type="number"
												required
												min={0.01}
												max={0.9999999999999999}
												step="any"
												value={economy.reduceMultiplier}
												onChange={(event) =>
													setEconomy({
														...economy,
														reduceMultiplier: Number(event.target.value),
													})
												}
											/>
										</label>
										<button
											type="submit"
											className="button button-dark"
											disabled={busy}
										>
											Save token settings
										</button>
									</form>
								</div>
								<button
									type="button"
									className="quiet-link logout"
									onClick={async () => {
										await request('/admin/session', { method: 'DELETE' })
										setAdmin(false)
										setPlaces([])
									}}
								>
									Lock admin tools
								</button>
							</div>
						)}
					</section>
				</details>
			)}

			<footer className="footer">
				<span className="brand">
					<Image
						className="brand-logo"
						src="/android-chrome-192x192.png"
						alt=""
						width={192}
						height={192}
					/>
					<span className="brand-title">Gambling about lunch</span>
				</span>
				<Link href="/api/v1/health">Service health ↗</Link>
			</footer>
			{checkInConfirmOpen && (
				<dialog
					open
					className="dialog-backdrop"
					aria-modal="true"
					aria-labelledby="check-in-heading"
					aria-describedby="check-in-pledge"
					onClick={(event) => {
						if (event.target === event.currentTarget) closeCheckInDialog()
					}}
				>
					<section
						className="confirm-dialog"
						onKeyDown={(event) => {
							if (event.key !== 'Tab') return
							if (
								event.shiftKey &&
								document.activeElement === cancelCheckIn.current
							) {
								event.preventDefault()
								confirmCheckIn.current?.focus()
							} else if (
								!event.shiftKey &&
								document.activeElement === confirmCheckIn.current
							) {
								event.preventDefault()
								cancelCheckIn.current?.focus()
							} else if (
								document.activeElement !== cancelCheckIn.current &&
								document.activeElement !== confirmCheckIn.current
							) {
								event.preventDefault()
								;(event.shiftKey
									? confirmCheckIn.current
									: cancelCheckIn.current
								)?.focus()
							}
						}}
					>
						<h2 id="check-in-heading">Swear your pledge to the Wheel</h2>
						<p id="check-in-pledge" data-testid="check-in-pledge">
							{today?.preferences.checkInPledge ??
								defaultGamePreferences.checkInPledge}
						</p>
						{error && (
							<p className="setup-error" role="alert">
								{error}
							</p>
						)}
						<div className="dialog-actions">
							<button
								ref={cancelCheckIn}
								className="button button-light"
								type="button"
								onClick={closeCheckInDialog}
							>
								I decline
							</button>
							<button
								ref={confirmCheckIn}
								className="button button-yellow"
								type="button"
								disabled={busy || !canCheckIn}
								onClick={() => {
									if (busy || !canCheckIn) return
									checkInConfirmed.current = true
									checkInTrigger.current?.click()
								}}
							>
								{busy ? 'Taking the oath…' : 'I swear it'}
							</button>
						</div>
					</section>
				</dialog>
			)}
			{removeTarget && (
				<div className="dialog-backdrop">
					<section
						className="confirm-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="remove-person-heading"
						aria-describedby="remove-person-description"
						onKeyDown={(event) => {
							if (event.key !== 'Tab') return
							if (busy) {
								event.preventDefault()
								cancelRemoval.current?.focus()
								return
							}
							if (
								event.shiftKey &&
								document.activeElement === cancelRemoval.current
							) {
								event.preventDefault()
								confirmRemoval.current?.focus()
							} else if (
								!event.shiftKey &&
								document.activeElement === confirmRemoval.current
							) {
								event.preventDefault()
								cancelRemoval.current?.focus()
							} else if (
								document.activeElement !== cancelRemoval.current &&
								document.activeElement !== confirmRemoval.current
							) {
								event.preventDefault()
								;(event.shiftKey
									? confirmRemoval.current
									: cancelRemoval.current
								)?.focus()
							}
						}}
					>
						<h2 id="remove-person-heading">Remove person?</h2>
						<p id="remove-person-description">
							Remove <strong>{removeTarget.name}</strong>? Profiles without
							history are deleted. Profiles with history are archived, with
							their history preserved.
						</p>
						<div className="dialog-actions">
							<button
								ref={cancelRemoval}
								className="button button-light"
								type="button"
								onClick={() => {
									setRemoveTarget(null)
									window.setTimeout(() => removeTrigger.current?.focus(), 0)
								}}
							>
								Cancel
							</button>
							<button
								ref={confirmRemoval}
								className="button button-dark"
								type="button"
								disabled={busy}
								onClick={() => void removeParticipant()}
							>
								Remove person
							</button>
						</div>
					</section>
				</div>
			)}
			<div className="announcement" aria-live="polite" role="status">
				{error || notice}
			</div>
		</main>
	)
}
