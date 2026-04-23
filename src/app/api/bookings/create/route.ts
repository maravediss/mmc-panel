import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { createBookingEvent } from '@/lib/graph';
import { format } from 'date-fns';

const TIPO_LABEL: Record<string, string> = {
  prueba_moto: 'Prueba de moto',
  concesionario: 'Cita concesionario',
  taller: 'Cita taller',
};

const DURATION_MIN: Record<string, number> = {
  prueba_moto: 45,
  concesionario: 60,
  taller: 30,
};

export async function POST(req: Request) {
  const supabase = createClient();
  const admin = createAdminClient();

  // Verificar usuario autenticado con permisos
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: me } = await admin
    .from('mmc_commercials')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || !['admin', 'gerente', 'operadora'].includes(me.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const {
    lead_id,
    tipo,
    fecha_iso, // '2026-05-15T10:00:00' (hora local Madrid)
    commercial_id,
    notas,
  } = body || {};

  if (!lead_id || !tipo || !fecha_iso || !commercial_id) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }
  if (!['prueba_moto', 'concesionario', 'taller'].includes(tipo)) {
    return NextResponse.json({ error: 'tipo inválido' }, { status: 400 });
  }

  // Cargar lead + comercial
  const [{ data: lead }, { data: commercial }] = await Promise.all([
    admin
      .from('mmc_leads')
      .select('id, nombre, email, telefono, modelo_raw, formulario, origen, mensajes_preferencias')
      .eq('id', lead_id)
      .maybeSingle(),
    admin
      .from('mmc_commercials')
      .select('id, name, display_name, email')
      .eq('id', commercial_id)
      .maybeSingle(),
  ]);

  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  if (!commercial) return NextResponse.json({ error: 'commercial not found' }, { status: 404 });
  if (!commercial.email) {
    return NextResponse.json(
      { error: 'El comercial no tiene email configurado' },
      { status: 400 }
    );
  }

  const durationMin = DURATION_MIN[tipo];
  const start = new Date(fecha_iso);
  const end = new Date(start.getTime() + durationMin * 60000);
  const startIso = format(start, "yyyy-MM-dd'T'HH:mm:ss");
  const endIso = format(end, "yyyy-MM-dd'T'HH:mm:ss");

  const subject = `${TIPO_LABEL[tipo]} - ${lead.nombre}${lead.modelo_raw ? ' - ' + lead.modelo_raw : ''}`;
  const emailBody = [
    '<h3>Información del lead</h3>',
    `<p><strong>Nombre:</strong> ${escapeHtml(lead.nombre)}</p>`,
    lead.telefono ? `<p><strong>Teléfono:</strong> ${escapeHtml(lead.telefono)}</p>` : '',
    lead.email ? `<p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>` : '',
    lead.modelo_raw
      ? `<p><strong>Modelo de interés:</strong> ${escapeHtml(lead.modelo_raw)}</p>`
      : '',
    lead.origen ? `<p><strong>Origen:</strong> ${escapeHtml(lead.origen)}</p>` : '',
    lead.formulario
      ? `<p><strong>Formulario:</strong> ${escapeHtml(lead.formulario)}</p>`
      : '',
    lead.mensajes_preferencias
      ? `<p><strong>Mensaje del lead:</strong> ${escapeHtml(lead.mensajes_preferencias)}</p>`
      : '',
    notas ? `<h3>Notas de la operadora</h3><p>${escapeHtml(notas)}</p>` : '',
    '<hr>',
    '<p><em>Cita creada desde el panel MMC · Yamaha Málaga Center</em></p>',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    // 1) Crear evento en Graph (Bookings mailbox)
    const ev = await createBookingEvent({
      subject,
      body: emailBody,
      startIsoMadrid: startIso,
      endIsoMadrid: endIso,
      commercialEmail: commercial.email,
      leadEmail: lead.email || undefined,
      leadName: lead.nombre,
      categories: [tipo],
    });

    // 2) Crear registro en Supabase
    const { data: inserted, error: insErr } = await admin
      .from('mmc_appointments')
      .insert({
        lead_id: lead.id,
        commercial_id: commercial.id,
        tipo,
        fecha_cita: start.toISOString(),
        status: 'pending',
        notes: notas || null,
        graph_event_id: ev.id,
        graph_ical_uid: ev.iCalUId,
        graph_organizer_email: ev.organizer?.emailAddress?.address || null,
        graph_last_sync_at: new Date().toISOString(),
        sync_source: 'panel',
      })
      .select('id')
      .single();

    if (insErr) {
      // La cita se creó en Graph pero falló local → intentar revertir
      // (no es atómico pero minimizamos inconsistencia)
      try {
        const { deleteBookingEvent } = await import('@/lib/graph');
        await deleteBookingEvent(ev.id);
      } catch {}
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // 3) Update lead status
    await admin
      .from('mmc_leads')
      .update({ status: 'appointment' })
      .eq('id', lead.id);

    return NextResponse.json({
      ok: true,
      appointment_id: inserted.id,
      graph_event_id: ev.id,
      graph_web_link: ev.webLink,
    });
  } catch (e: any) {
    console.error('[api/bookings/create]', e);
    return NextResponse.json({ error: e.message || 'graph error' }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
