//! Aggregations for the Analytics page (T2.5 + T5.6 + T6.1).
//!
//! Everything is computed in a single `lock()` so the UI gets a
//! consistent snapshot even if a chat write lands mid-rollup.

use rusqlite::params;
use serde::Serialize;

use super::Db;

#[derive(Debug, Clone, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayCount {
    /// ISO date `YYYY-MM-DD` (UTC). The frontend localizes on render.
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsTotals {
    pub sessions: i64,
    pub messages: i64,
    pub tool_calls: i64,
    /// Distinct UTC dates on which any message was written.
    pub active_days: i64,
    /// Sum of prompt + completion across all assistant messages that have
    /// usage recorded. Pre-T2.4 rows contribute 0.
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    /// T6.1 — lifetime 👍 / 👎 counts across all messages. Pre-T6.1
    /// rows (feedback=NULL) contribute 0 to both.
    pub feedback_up: i64,
    pub feedback_down: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsSummary {
    pub totals: AnalyticsTotals,
    /// Messages/day for the trailing 30 days (inclusive). Dates with zero
    /// messages are omitted — the frontend pads the series for rendering.
    pub messages_per_day: Vec<DayCount>,
    /// `(prompt + completion)`-tokens per UTC day for the trailing 30 days.
    /// Same sparse shape as `messages_per_day`.
    pub tokens_per_day: Vec<DayCount>,
    /// Top 5 models by session count. `unknown` bucket covers NULL model.
    pub model_usage: Vec<NamedCount>,
    /// Top 10 tools by invocation count.
    pub tool_usage: Vec<NamedCount>,
    /// T5.6 — session count per adapter. Backfilled rows predating
    /// T5.5c land under `'hermes'` (the v5 migration fills NULL with
    /// 'hermes'). No `LIMIT` here since the adapter space is tiny
    /// (3 today, likely ≤ 6 ever); the UI renders the full list.
    pub adapter_usage: Vec<NamedCount>,
    pub generated_at: i64,
}

impl Db {
    /// Produce everything the Analytics page needs in a single `lock()`.
    /// All timestamps in the DB are Unix ms; `now_ms` is used both for the
    /// 30-day window and for `generated_at` so tests can pin the clock.
    pub fn analytics_summary(&self, now_ms: i64) -> rusqlite::Result<AnalyticsSummary> {
        let conn = self.conn.lock();

        let sessions: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?;
        let messages: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
        let tool_calls: i64 =
            conn.query_row("SELECT COUNT(*) FROM tool_calls", [], |r| r.get(0))?;
        let active_days: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT date(created_at/1000, 'unixepoch')) FROM messages",
            [],
            |r| r.get(0),
        )?;

        // Lifetime token totals. COALESCE + SUM lets pre-T2.4 rows (NULL
        // tokens) contribute 0 without blowing up the SUM on an all-NULL set.
        let (prompt_tokens, completion_tokens): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0)
             FROM messages",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let total_tokens = prompt_tokens + completion_tokens;

        // T6.1 — lifetime feedback counts.
        let feedback_up: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE feedback = 'up'",
            [],
            |r| r.get(0),
        )?;
        let feedback_down: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE feedback = 'down'",
            [],
            |r| r.get(0),
        )?;

        // 30-day window. created_at is ms since epoch.
        let since = now_ms - 30 * 86_400_000;
        let mut stmt = conn.prepare(
            "SELECT date(created_at/1000, 'unixepoch') AS d, COUNT(*)
             FROM messages
             WHERE created_at >= ?1
             GROUP BY d
             ORDER BY d",
        )?;
        let messages_per_day: Vec<DayCount> = stmt
            .query_map(params![since], |row| {
                Ok(DayCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut tstmt_day = conn.prepare(
            "SELECT date(created_at/1000, 'unixepoch') AS d,
                    COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS tok
             FROM messages
             WHERE created_at >= ?1
               AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
             GROUP BY d
             HAVING tok > 0
             ORDER BY d",
        )?;
        let tokens_per_day: Vec<DayCount> = tstmt_day
            .query_map(params![since], |row| {
                Ok(DayCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut mstmt = conn.prepare(
            "SELECT COALESCE(NULLIF(model, ''), 'unknown') AS m, COUNT(*)
             FROM sessions
             GROUP BY m
             ORDER BY COUNT(*) DESC
             LIMIT 5",
        )?;
        let model_usage: Vec<NamedCount> = mstmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut tstmt = conn.prepare(
            "SELECT tool, COUNT(*)
             FROM tool_calls
             GROUP BY tool
             ORDER BY COUNT(*) DESC
             LIMIT 10",
        )?;
        let tool_usage: Vec<NamedCount> = tstmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut astmt = conn.prepare(
            "SELECT COALESCE(NULLIF(adapter_id, ''), 'hermes') AS a, COUNT(*)
             FROM sessions
             GROUP BY a
             ORDER BY COUNT(*) DESC",
        )?;
        let adapter_usage: Vec<NamedCount> = astmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(AnalyticsSummary {
            totals: AnalyticsTotals {
                sessions,
                messages,
                tool_calls,
                active_days,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                feedback_up,
                feedback_down,
            },
            messages_per_day,
            tokens_per_day,
            model_usage,
            tool_usage,
            adapter_usage,
            generated_at: now_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{MessageRow, ToolCallRow};
    use crate::db::sessions::SessionRow;

    fn sample_session(id: &str, ts: i64) -> SessionRow {
        SessionRow {
            id: id.into(),
            title: "t".into(),
            model: None,
            created_at: ts,
            updated_at: ts,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
        }
    }

    fn sample_msg(id: &str, ts: i64) -> MessageRow {
        MessageRow {
            id: id.into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "hi".into(),
            error: None,
            position: 0,
            created_at: ts,
            prompt_tokens: None,
            completion_tokens: None,
            feedback: None,
        }
    }

    /// T5.6 — adapter_usage aggregation. Three sessions split across
    /// two adapters; the summary must reflect the counts with the
    /// larger bucket first (matches ORDER BY COUNT DESC).
    #[test]
    fn t56_analytics_adapter_usage_groups_by_adapter_id() {
        let db = Db::open_in_memory().unwrap();
        for (i, adapter) in ["hermes", "hermes", "claude_code"].iter().enumerate() {
            db.upsert_session(&SessionRow {
                id: format!("s{i}"),
                title: "t".into(),
                model: None,
                created_at: (i as i64) * 1_000,
                updated_at: (i as i64) * 1_000,
                adapter_id: (*adapter).into(),
                llm_profile_id: None,
            })
            .unwrap();
        }
        let summary = db.analytics_summary(10_000).unwrap();
        let by_name: Vec<(&str, i64)> = summary
            .adapter_usage
            .iter()
            .map(|c| (c.name.as_str(), c.count))
            .collect();
        assert_eq!(by_name, vec![("hermes", 2), ("claude_code", 1)]);
    }

    #[test]
    fn analytics_summary_aggregates_counts_and_windows() {
        let db = Db::open_in_memory().unwrap();

        db.upsert_session(&SessionRow {
            id: "s1".into(),
            title: "t".into(),
            model: Some("deepseek-chat".into()),
            created_at: 1_000,
            updated_at: 1_000,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s2".into(),
            title: "t".into(),
            model: None,
            created_at: 2_000,
            updated_at: 2_000,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
        })
        .unwrap();

        let day_ms = 86_400_000i64;
        let now = 50 * day_ms;
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "user".into(),
            content: "x".into(),
            error: None,
            position: 0,
            created_at: now - 5 * day_ms,
            prompt_tokens: Some(11),
            completion_tokens: None,
            feedback: None,
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m2".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "y".into(),
            error: None,
            position: 1,
            created_at: now - 5 * day_ms + 1_000,
            prompt_tokens: Some(20),
            completion_tokens: Some(33),
            feedback: None,
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m3".into(),
            session_id: "s2".into(),
            role: "user".into(),
            content: "z".into(),
            error: None,
            position: 0,
            created_at: now - 45 * day_ms,
            prompt_tokens: Some(999),
            completion_tokens: Some(999),
            feedback: None,
        })
        .unwrap();

        for i in 0..2 {
            db.append_tool_call(&ToolCallRow {
                id: format!("t{i}"),
                message_id: "m1".into(),
                tool: "terminal".into(),
                emoji: None,
                label: None,
                at: now - 5 * day_ms,
            })
            .unwrap();
        }
        db.append_tool_call(&ToolCallRow {
            id: "tw".into(),
            message_id: "m2".into(),
            tool: "web_search".into(),
            emoji: None,
            label: None,
            at: now - 5 * day_ms,
        })
        .unwrap();

        let s = db.analytics_summary(now).unwrap();
        assert_eq!(s.totals.sessions, 2);
        assert_eq!(s.totals.messages, 3);
        assert_eq!(s.totals.tool_calls, 3);
        assert_eq!(s.totals.active_days, 2);

        assert_eq!(s.totals.prompt_tokens, 11 + 20 + 999);
        assert_eq!(s.totals.completion_tokens, 33 + 999);
        assert_eq!(
            s.totals.total_tokens,
            s.totals.prompt_tokens + s.totals.completion_tokens
        );

        assert_eq!(s.messages_per_day.len(), 1);
        assert_eq!(s.messages_per_day[0].count, 2);

        assert_eq!(s.tokens_per_day.len(), 1);
        assert_eq!(s.tokens_per_day[0].count, 11 + 20 + 33);

        let names: Vec<_> = s.model_usage.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"deepseek-chat"));
        assert!(names.contains(&"unknown"));

        assert_eq!(s.tool_usage[0].name, "terminal");
        assert_eq!(s.tool_usage[0].count, 2);
        assert_eq!(s.tool_usage[1].name, "web_search");
        assert_eq!(s.tool_usage[1].count, 1);
    }

    #[test]
    fn t61_analytics_summary_counts_feedback() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_session(&sample_session("s1", 100)).unwrap();
        for (i, fb) in ["up", "up", "down", ""].iter().enumerate() {
            let mut m = sample_msg(&format!("m{i}"), 100 + i as i64);
            m.position = i as i64;
            db.upsert_message(&m).unwrap();
            if !fb.is_empty() {
                db.set_message_feedback(&m.id, Some(fb)).unwrap();
            }
        }
        let s = db.analytics_summary(1_000).unwrap();
        assert_eq!(s.totals.feedback_up, 2);
        assert_eq!(s.totals.feedback_down, 1);
    }
}
