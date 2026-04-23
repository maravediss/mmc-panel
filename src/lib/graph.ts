// Microsoft Graph API helper for Bookings calendar ops.
// Usa client credentials flow. SOLO SERVER-SIDE (usa secret).

const TENANT = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const BOOKINGS_MAILBOX = process.env.AZURE_BOOKINGS_MAILBOX || 'CitasMMC@Interhanse.com';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Azure credentials not configured (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET)');
  }
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`OAuth fail ${res.status}: ${await res.text()}`);
  const j = await res.json();
  _token = j.access_token;
  _tokenExpiry = Date.now() + j.expires_in * 1000;
  return _token!;
}

type GraphRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

async function graph<T = unknown>({ method = 'GET', path, body }: GraphRequest): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="Europe/Madrid"',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph ${method} ${path} ${res.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

// ---------- Calendar events ----------

export type CreateEventParams = {
  subject: string;
  body?: string;
  startIsoMadrid: string; // '2026-05-01T10:00:00'
  endIsoMadrid: string;
  commercialEmail: string; // attendee principal (francisco.*@malagamotocenter.com)
  leadEmail?: string;
  leadName?: string;
  location?: string;
  categories?: string[];
};

export type GraphEvent = {
  id: string;
  iCalUId: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: { emailAddress: { address: string; name?: string }; type?: string }[];
  organizer: { emailAddress: { address: string; name?: string } };
  webLink: string;
  isCancelled: boolean;
};

export async function createBookingEvent(p: CreateEventParams): Promise<GraphEvent> {
  const attendees = [
    {
      emailAddress: { address: p.commercialEmail },
      type: 'required',
    },
  ];
  if (p.leadEmail) {
    attendees.push({
      emailAddress: { address: p.leadEmail, name: p.leadName } as { address: string; name?: string },
      type: 'required',
    });
  }

  const payload = {
    subject: p.subject,
    body: {
      contentType: 'HTML',
      content: p.body || '',
    },
    start: { dateTime: p.startIsoMadrid, timeZone: 'Europe/Madrid' },
    end: { dateTime: p.endIsoMadrid, timeZone: 'Europe/Madrid' },
    attendees,
    location: p.location
      ? { displayName: p.location }
      : { displayName: 'Málaga Motocenter - Concesionario oficial Yamaha' },
    categories: p.categories || [],
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
  };

  return graph<GraphEvent>({
    method: 'POST',
    path: `/users/${BOOKINGS_MAILBOX}/calendar/events`,
    body: payload,
  });
}

export async function updateBookingEvent(
  eventId: string,
  patch: Partial<{
    subject: string;
    body: string;
    startIsoMadrid: string;
    endIsoMadrid: string;
  }>
): Promise<GraphEvent> {
  const body: Record<string, unknown> = {};
  if (patch.subject) body.subject = patch.subject;
  if (patch.body) body.body = { contentType: 'HTML', content: patch.body };
  if (patch.startIsoMadrid)
    body.start = { dateTime: patch.startIsoMadrid, timeZone: 'Europe/Madrid' };
  if (patch.endIsoMadrid)
    body.end = { dateTime: patch.endIsoMadrid, timeZone: 'Europe/Madrid' };

  return graph<GraphEvent>({
    method: 'PATCH',
    path: `/users/${BOOKINGS_MAILBOX}/calendar/events/${eventId}`,
    body,
  });
}

export async function cancelBookingEvent(eventId: string, comment?: string): Promise<void> {
  // Envía cancelación + email a attendees
  await graph({
    method: 'POST',
    path: `/users/${BOOKINGS_MAILBOX}/calendar/events/${eventId}/cancel`,
    body: { comment: comment || 'Cita cancelada' },
  });
}

export async function deleteBookingEvent(eventId: string): Promise<void> {
  // Borrado silencioso (sin notificar)
  await graph({
    method: 'DELETE',
    path: `/users/${BOOKINGS_MAILBOX}/calendar/events/${eventId}`,
  });
}
