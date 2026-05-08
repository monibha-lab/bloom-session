// Process session end: compute rewards, update profiles, write results & logs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  session_id: string;
  succeeded: boolean; // whether timer reached 0 vs early-exit fail
  duration_seconds: number; // actual elapsed
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return json({ error: 'Unauthorized' }, 401);
    const callerId = userRes.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const body: Body = await req.json();
    const { session_id, succeeded, duration_seconds } = body;
    if (!session_id || typeof duration_seconds !== 'number') {
      return json({ error: 'Bad input' }, 400);
    }

    // Fetch session
    const { data: session, error: sErr } = await admin
      .from('sessions').select('*').eq('id', session_id).single();
    if (sErr || !session) return json({ error: 'Session not found' }, 404);

    // Host can finalize either way; members can only finalize as failure (when leaving early)
    if (session.host_id !== callerId && succeeded) {
      return json({ error: 'Only host can mark success' }, 403);
    }

    if (session.status === 'completed' || session.status === 'failed') {
      return json({ ok: true, already: true });
    }

    // Members
    const { data: members } = await admin
      .from('session_members').select('user_id').eq('session_id', session_id);
    const memberIds = (members ?? []).map((m: any) => m.user_id);

    // Tasks per user
    const { data: tasks } = await admin
      .from('tasks').select('user_id, completed').eq('session_id', session_id);
    const tasksByUser: Record<string, { total: number; done: number }> = {};
    for (const uid of memberIds) tasksByUser[uid] = { total: 0, done: 0 };
    for (const t of tasks ?? []) {
      const e = tasksByUser[t.user_id] ??= { total: 0, done: 0 };
      e.total++;
      if (t.completed) e.done++;
    }

    const minDuration = duration_seconds >= 600; // 10 minutes
    const isGroup = session.mode === 'group' && memberIds.length > 1;
    const baseStars = Math.max(1, Math.floor((duration_seconds / 3600) * 10));

    // Determine per-user success: task completion fully done if user has tasks; otherwise rely on timer
    const userSucceeded: Record<string, boolean> = {};
    for (const uid of memberIds) {
      const t = tasksByUser[uid] ?? { total: 0, done: 0 };
      const tasksOk = t.total === 0 ? true : t.done === t.total;
      userSucceeded[uid] = succeeded && tasksOk && minDuration;
    }

    const allSucceeded = memberIds.every((u) => userSucceeded[u]) && memberIds.length > 0;
    const groupFailed = isGroup && !allSucceeded;
    const soloFailed = !isGroup && memberIds.length === 1 && !userSucceeded[memberIds[0]];

    const today = new Date().toISOString().slice(0, 10);

    for (const uid of memberIds) {
      let starsDelta = 0;
      let flamesDelta = 0;
      const ok = userSucceeded[uid];
      const t = tasksByUser[uid] ?? { total: 0, done: 0 };

      if (ok && minDuration) {
        starsDelta = baseStars;
        if (isGroup && allSucceeded) starsDelta += 2;
      } else if (!minDuration) {
        starsDelta = 0;
      } else if (groupFailed) {
        starsDelta = -2;
        if (!ok) starsDelta -= 3;
      } else if (soloFailed) {
        starsDelta = -2;
      }

      // Update profile
      const { data: profile } = await admin
        .from('profiles').select('*').eq('id', uid).single();
      if (!profile) continue;

      let newStars = Math.max(0, (profile.stars ?? 0) + starsDelta);
      let newFlames = profile.blue_flames ?? 0;
      let newSessionsCompleted = profile.sessions_completed ?? 0;
      let newTotalSeconds = profile.total_seconds ?? 0;
      let newStreak = profile.current_streak ?? 0;
      let newLastDate = profile.last_session_date;

      if (ok) {
        newSessionsCompleted += 1;
        newTotalSeconds += duration_seconds;
        // streak
        if (profile.last_session_date) {
          const last = new Date(profile.last_session_date);
          const diff = Math.floor((Date.parse(today) - last.getTime()) / 86400000);
          if (diff === 0) {
            // same day, no change
          } else if (diff === 1) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
        } else {
          newStreak = 1;
        }
        newLastDate = today;
        // every 10 completed
        if (newSessionsCompleted % 10 === 0) {
          newFlames += 1;
          flamesDelta += 1;
        }
        // 7-day streak
        if (newStreak === 7) {
          newFlames += 1;
          flamesDelta += 1;
        }
      }

      await admin.from('profiles').update({
        stars: newStars,
        blue_flames: newFlames,
        sessions_completed: newSessionsCompleted,
        total_seconds: newTotalSeconds,
        current_streak: newStreak,
        last_session_date: newLastDate,
        updated_at: new Date().toISOString(),
      }).eq('id', uid);

      await admin.from('session_results').insert({
        session_id, user_id: uid,
        stars_delta: starsDelta,
        flames_delta: flamesDelta,
        succeeded: ok,
        tasks_completed: t.done,
        tasks_total: t.total,
        duration_seconds,
      });

      await admin.from('study_logs').insert({
        user_id: uid, session_id,
        duration_seconds, succeeded: ok, date: today,
      });
    }

    await admin.from('sessions').update({
      status: allSucceeded ? 'completed' : 'failed',
      ended_at: new Date().toISOString(),
    }).eq('id', session_id);

    return json({ ok: true, succeeded: allSucceeded });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? 'error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
