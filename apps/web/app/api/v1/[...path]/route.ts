import { createDatabase, GameError, GameService, isReplay } from '@lunch/db';
import {
  adminLogin,
  attendanceRequest,
  createParticipant,
  createPlace,
  id,
  participantSelection,
  participantRemoval,
  purchaseRequest,
  pushSubscription,
  schedule as scheduleSchema,
  setupStatus,
  gamePreferences,
  economySettings,
  attendanceStatus,
  tokenCorrection,
  tokenBalanceList,
  tokenBalanceSetRequest,
  tokenBalanceSetResponse,
  restaurantOddsResponse,
  setRestaurantOddsRequest,
  updateParticipant,
  updatePlace,
  setBetRequest,
  cancelBetRequest,
  currentBetsResponse,
  betMutationResponse,
  dailyActivityQuery,
  dailyActivityResponse,
  currentInfluenceResponse,
  changeInfluenceRequest,
  influenceMutationResponse,
  healthRuleSettings,
  transferRequest,
  transferResponse,
} from '@lunch/contracts';
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from 'node:crypto';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };
type ErrorBody = { error: { code: string; message: string } };
const COOKIE = 'lunch-roller-admin';
const SESSION_SECONDS = 8 * 60 * 60;
const loginAttempts = new Map<string, { count: number; reset: number }>();
let app: { service: GameService; close: () => Promise<void> } | undefined;

function service() {
  if (!app) {
    const database = createDatabase();
    app = { service: new GameService(database), close: database.close };
  }
  return app.service;
}

function safeEqual(left: string, right: string) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return (
    timingSafeEqual(a, b) &&
    Buffer.byteLength(left) === Buffer.byteLength(right)
  );
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('Session unavailable');
  return secret;
}

function signature(value: string) {
  return createHmac('sha256', sessionSecret())
    .update(value)
    .digest('base64url');
}

function sessionCookie() {
  const value = `${Date.now() + SESSION_SECONDS * 1000}.${randomBytes(24).toString('base64url')}`;
  return `${COOKIE}=${value}.${signature(value)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').protocol === 'https:' ? '; Secure' : ''}`;
}

function isAdmin(request: Request) {
  try {
    const raw = request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!raw) return false;
    const pieces = raw.split('.');
    if (pieces.length !== 3 || !/^\d+$/.test(pieces[0]!)) return false;
    const value = `${pieces[0]}.${pieces[1]}`;
    if (!safeEqual(signature(value), pieces[2]!)) return false;
    return Number(pieces[0]) > Date.now();
  } catch {
    return false;
  }
}

function verifyOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  const origin = request.headers.get('origin');
  if (!configured || !origin) return false;
  try {
    return new URL(configured).origin === origin;
  } catch {
    return false;
  }
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } } satisfies ErrorBody, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function response(body?: unknown, status = 200, headers?: HeadersInit) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  });
}

async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), {
      status: 400,
      code: 'INVALID_JSON',
    });
  }
}

function parse<T>(
  schema: {
    safeParse: (
      input: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw Object.assign(
      new Error('Request does not match the expected format.'),
      { status: 400, code: 'INVALID_REQUEST' },
    );
  return result.data;
}

function participantId(request: Request) {
  const value = request.headers.get('x-participant-id');
  if (!value)
    throw Object.assign(new Error('Select a participant first.'), {
      status: 401,
      code: 'IDENTITY_REQUIRED',
    });
  return parse(participantSelection, { participantId: value }).participantId;
}

function idempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key');
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw Object.assign(new Error('A valid Idempotency-Key is required.'), {
      status: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  }
  return value;
}

function requireAdmin(request: Request) {
  if (!isAdmin(request))
    throw Object.assign(new Error('Administrator session required.'), {
      status: 401,
      code: 'ADMIN_REQUIRED',
    });
}

function loginLimited() {
  const key = 'admin-login';
  const now = Date.now();
  for (const [candidate, attempt] of loginAttempts)
    if (attempt.reset <= now) loginAttempts.delete(candidate);
  if (loginAttempts.size > 500) loginAttempts.clear();
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.count >= 8 && attempt.reset > now) return true;
  loginAttempts.set(key, {
    count: (attempt?.count ?? 0) + 1,
    reset:
      attempt && attempt.reset > now ? attempt.reset : now + 15 * 60 * 1000,
  });
  return false;
}

async function dispatch(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const route = `/${path.join('/')}`;
  const method = request.method.toUpperCase();
  if (method !== 'GET' && !verifyOrigin(request))
    return error(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
  try {
    if (route === '/push-config' && method === 'GET') {
      const configured = Boolean(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT,
      );
      return response({
        publicKey: configured ? process.env.VAPID_PUBLIC_KEY! : null,
      });
    }
    if (route === '/admin/session' && method === 'POST') {
      if (loginLimited())
        return error(
          429,
          'LOGIN_RATE_LIMITED',
          'Too many login attempts. Try again later.',
        );
      const input = parse(adminLogin, await body(request));
      const configured = process.env.ADMIN_PASSWORD ?? '';
      if (!configured || !safeEqual(input.password, configured))
        return error(401, 'INVALID_CREDENTIALS', 'Password was not accepted.');
      loginAttempts.delete('admin-login');
      return response(undefined, 204, { 'Set-Cookie': sessionCookie() });
    }
    if (route === '/admin/session' && method === 'DELETE') {
      requireAdmin(request);
      return response(undefined, 204, {
        'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').protocol === 'https:' ? '; Secure' : ''}`,
      });
    }
    const game = service();
    if (route === '/setup' && method === 'GET')
      return response(setupStatus.parse(await game.getSetupStatus()));
    if (
      !route.startsWith('/admin/') &&
      !(await game.getSetupStatus()).completed
    )
      return error(
        403,
        'SETUP_REQUIRED',
        'An administrator must finish setup first.',
      );
    if (route === '/participants' && method === 'GET')
      return response({ participants: await game.listParticipants() });
    if (route === '/identity/select' && method === 'POST') {
      const input = parse(participantSelection, await body(request));
      return response(await game.selectParticipant(input.participantId));
    }
    if (route === '/today' && method === 'GET')
      return response(await game.today());
    if (route === '/transfers' && method === 'POST')
      return response(
        transferResponse.parse(
          await game.transferTokens(
            participantId(request),
            parse(transferRequest, await body(request)),
            idempotencyKey(request),
          ),
        ),
      );
    if (route === '/wallet' && method === 'GET')
      return response(await game.wallet(participantId(request)));
    if (route === '/influence/current' && method === 'GET')
      return response(
        currentInfluenceResponse.parse(
          await game.currentInfluence(participantId(request)),
        ),
      );
    if (route === '/influence/current' && method === 'POST')
      return response(
        influenceMutationResponse.parse(
          await game.changeInfluence(
            participantId(request),
            parse(changeInfluenceRequest, await body(request)),
            idempotencyKey(request),
          ),
        ),
      );
    if (route === '/activity' && method === 'GET') {
      const query = parse(dailyActivityQuery, {
        date: request.nextUrl.searchParams.get('date') ?? undefined,
      });
      return response(
        dailyActivityResponse.parse(
          await game.dailyActivity(participantId(request), query.date),
        ),
      );
    }
    if (route === '/bets/current' && method === 'GET')
      return response(
        currentBetsResponse.parse(
          await game.currentBets(participantId(request)),
        ),
      );
    if (route === '/bets/current' && method === 'PUT')
      return response(
        betMutationResponse.parse(
          await game.setBet(
            participantId(request),
            parse(setBetRequest, await body(request)),
            idempotencyKey(request),
          ),
        ),
      );
    if (route === '/bets/current' && method === 'DELETE')
      return response(
        betMutationResponse.parse(
          await game.cancelBet(
            participantId(request),
            parse(cancelBetRequest, await body(request)),
            idempotencyKey(request),
          ),
        ),
      );
    if (route === '/attendance' && method === 'GET')
      return response(
        attendanceStatus.parse(
          await game.attendanceStatus(participantId(request)),
        ),
      );
    if (route === '/attendance' && method === 'POST')
      return response(
        await game.attend(
          participantId(request),
          parse(attendanceRequest, await body(request)),
          idempotencyKey(request),
        ),
      );
    if (route === '/purchases' && method === 'POST')
      return response(
        await game.purchase(
          participantId(request),
          parse(purchaseRequest, await body(request)),
          idempotencyKey(request),
        ),
      );
    if (route === '/places' && method === 'POST') {
      const result = await game.addPlace(
        participantId(request),
        parse(createPlace, await body(request)),
        idempotencyKey(request),
      );
      return response(result, isReplay(result) ? 200 : 201);
    }
    if (route === '/push-subscriptions' && method === 'POST')
      return response(
        await game.subscribe(
          participantId(request),
          parse(pushSubscription, await body(request)),
        ),
        201,
      );
    const unsubscribe = route.match(/^\/push-subscriptions\/([^/]+)$/i);
    if (unsubscribe && method === 'DELETE') {
      await game.unsubscribe(participantId(request), parse(id, unsubscribe[1]));
      return response(undefined, 204);
    }
    if (route.startsWith('/admin/')) requireAdmin(request);
    if (route === '/admin/health-rule' && method === 'GET')
      return response(healthRuleSettings.parse(await game.getHealthRule()));
    if (route === '/admin/health-rule' && method === 'PUT')
      return response(
        healthRuleSettings.parse(
          await game.setHealthRule(
            parse(healthRuleSettings, await body(request)),
          ),
        ),
      );
    if (route === '/admin/economy' && method === 'GET')
      return response(economySettings.parse(await game.getEconomy()));
    if (route === '/admin/economy' && method === 'PUT')
      return response(
        economySettings.parse(
          await game.setEconomy(parse(economySettings, await body(request))),
        ),
      );
    if (route === '/admin/preferences' && method === 'GET')
      return response(gamePreferences.parse(await game.getPreferences()));
    if (route === '/admin/preferences' && method === 'PUT')
      return response(
        gamePreferences.parse(
          await game.setPreferences(
            parse(gamePreferences, await body(request)),
          ),
        ),
      );
    if (route === '/admin/setup/complete' && method === 'POST')
      return response(setupStatus.parse(await game.completeSetup()));
    if (route === '/admin/participants' && method === 'GET')
      return response({ participants: await game.listParticipants(true) });
    if (route === '/admin/token-balances' && method === 'GET')
      return response(tokenBalanceList.parse(await game.listTokenBalances()));
    if (route === '/admin/token-balances' && method === 'POST')
      return response(
        tokenBalanceSetResponse.parse(
          await game.setTokenBalance(
            parse(tokenBalanceSetRequest, await body(request)),
            idempotencyKey(request),
          ),
        ),
      );
    if (route === '/admin/participants' && method === 'POST')
      return response(
        await game.saveParticipant(
          parse(createParticipant, await body(request)),
        ),
        201,
      );
    const person = route.match(/^\/admin\/participants\/([^/]+)$/i);
    if (person && method === 'DELETE')
      return response(
        participantRemoval.parse(
          await game.removeParticipant(parse(id, person[1])),
        ),
      );
    if (person && method === 'PATCH')
      return response(
        await game.saveParticipant(
          parse(updateParticipant, await body(request)),
          parse(id, person[1]),
        ),
      );
    if (route === '/admin/places' && method === 'GET')
      return response({ places: await game.listPlaces(true) });
    if (route === '/admin/restaurant-odds' && method === 'GET')
      return response(
        restaurantOddsResponse.parse(await game.listRestaurantOdds()),
      );
    if (route === '/admin/restaurant-odds' && method === 'PUT')
      return response(
        restaurantOddsResponse.parse(
          await game.setRestaurantOdds(
            parse(setRestaurantOddsRequest, await body(request)),
          ),
        ),
      );
    if (route === '/admin/places' && method === 'POST')
      return response(
        await game.savePlace(parse(createPlace, await body(request))),
        201,
      );
    const place = route.match(/^\/admin\/places\/([^/]+)$/i);
    if (place && method === 'PATCH')
      return response(
        await game.savePlace(
          parse(updatePlace, await body(request)),
          parse(id, place[1]),
        ),
      );
    if (route === '/admin/schedule' && method === 'GET')
      return response(await game.getSchedule());
    if (route === '/admin/schedule' && method === 'PUT')
      return response(
        await game.setSchedule(parse(scheduleSchema, await body(request))),
      );
    if (route === '/admin/token-corrections' && method === 'POST')
      return response(
        await game.correctTokens(
          parse(tokenCorrection, await body(request)),
          idempotencyKey(request),
        ),
      );
    return error(404, 'NOT_FOUND', 'That API route was not found.');
  } catch (caught) {
    if (caught instanceof GameError)
      return error(caught.status, caught.code, caught.message);
    if (typeof caught === 'object' && caught !== null) {
      const known = caught as {
        status?: number;
        code?: string;
        message?: string;
      };
      if (known.status && known.code && known.message)
        return error(known.status, known.code, known.message);
    }
    if (caught instanceof SyntaxError)
      return error(
        400,
        'INVALID_REQUEST',
        'Request does not match the expected format.',
      );
    return error(
      503,
      'SERVICE_UNAVAILABLE',
      'The service is temporarily unavailable.',
    );
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
