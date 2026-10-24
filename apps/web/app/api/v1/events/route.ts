import { startGameStateListener } from '@lunch/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const encoder = new TextEncoder()
const HEARTBEAT_MS = 25_000
const RETRY = 'retry: 3000\n\n'
const CHANGE = 'event: game-state-changed\ndata: {}\n\n'

type Client = ReadableStreamDefaultController<Uint8Array>
type Listener = Awaited<ReturnType<typeof startGameStateListener>>

// Route modules are process-local in the Node runtime. Keep one PostgreSQL
// listener here and fan its state invalidations out to every local stream.
const clients = new Map<Client, () => void>()
let listenerPromise: Promise<Listener> | undefined

function ensureListener(): Promise<Listener> {
	if (!listenerPromise) {
		listenerPromise = startGameStateListener(() => {
			for (const client of clients.keys()) {
				try {
					client.enqueue(encoder.encode(CHANGE))
				} catch {
					clients.get(client)?.()
				}
			}
		}).catch((error: unknown) => {
			// Leave the stream open for fallback polling; let a later connection
			// retry listener startup if the database was temporarily unavailable.
			listenerPromise = undefined
			throw error
		})
	}
	return listenerPromise
}

function shutdown() {
	for (const [client, cleanup] of clients) {
		cleanup()
		try {
			client.close()
		} catch {
			// A disconnected client may already have closed its stream.
		}
	}
	const closingListener = listenerPromise
	listenerPromise = undefined
	if (closingListener)
		void closingListener
			.then((listener) => listener.close())
			.catch(() => undefined)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

export async function GET(request: Request) {
	let client: Client | undefined
	let heartbeat: ReturnType<typeof setInterval> | undefined
	let closed = false
	const cleanup = () => {
		if (closed) return
		closed = true
		if (heartbeat) clearInterval(heartbeat)
		if (client) clients.delete(client)
		request.signal.removeEventListener('abort', cleanup)
	}
	request.signal.addEventListener('abort', cleanup, { once: true })

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			client = controller
			controller.enqueue(encoder.encode(RETRY))
			heartbeat = setInterval(() => {
				if (closed) return
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'))
				} catch {
					cleanup()
				}
			}, HEARTBEAT_MS)
			clients.set(controller, cleanup)
			void ensureListener().catch(() => {
				// SSE remains connected; the browser's slower HTTP polling recovers.
			})
		},
		cancel() {
			cleanup()
		},
	})

	return new Response(body, {
		headers: {
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'Content-Type': 'text/event-stream; charset=utf-8',
			'X-Accel-Buffering': 'no',
		},
	})
}
