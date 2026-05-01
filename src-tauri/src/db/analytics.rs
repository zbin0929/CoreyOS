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
    pub active_days: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub feedback_up: i64,
    pub feedback_down: i64,
    pub estimated_cost_usd: f64,
    pub estimated_cost_cny: f64,
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

#[derive(Debug, Clone, Serialize)]
pub struct ModelCost {
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayCost {
    pub date: String,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostBreakdown {
    pub total_usd: f64,
    pub total_cny: f64,
    pub by_model: Vec<ModelCost>,
    pub daily_cost: Vec<DayCost>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LatencyStats {
    pub p50_ms: i64,
    pub p95_ms: i64,
    pub p99_ms: i64,
    pub avg_ms: i64,
    pub by_model: Vec<ModelLatency>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelLatency {
    pub model: String,
    pub p50_ms: i64,
    pub avg_ms: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorStats {
    pub total_errors: i64,
    pub total_messages: i64,
    pub error_rate: f64,
    pub daily_errors: Vec<DayCount>,
    pub top_error_types: Vec<NamedCount>,
}

struct ModelPrice {
    prefix: &'static str,
    input_per_m: f64,
    output_per_m: f64,
}

const MODEL_PRICES: &[ModelPrice] = &[
    ModelPrice {
        prefix: "gpt-4o",
        input_per_m: 2.5,
        output_per_m: 10.0,
    },
    ModelPrice {
        prefix: "gpt-4-turbo",
        input_per_m: 10.0,
        output_per_m: 30.0,
    },
    ModelPrice {
        prefix: "gpt-4-",
        input_per_m: 30.0,
        output_per_m: 60.0,
    },
    ModelPrice {
        prefix: "gpt-3.5-turbo",
        input_per_m: 0.5,
        output_per_m: 1.5,
    },
    ModelPrice {
        prefix: "claude-3.5-sonnet",
        input_per_m: 3.0,
        output_per_m: 15.0,
    },
    ModelPrice {
        prefix: "claude-3-opus",
        input_per_m: 15.0,
        output_per_m: 75.0,
    },
    ModelPrice {
        prefix: "claude-3-haiku",
        input_per_m: 0.25,
        output_per_m: 1.25,
    },
    ModelPrice {
        prefix: "deepseek-chat",
        input_per_m: 0.14,
        output_per_m: 0.28,
    },
    ModelPrice {
        prefix: "deepseek-reasoner",
        input_per_m: 0.55,
        output_per_m: 2.19,
    },
    ModelPrice {
        prefix: "gemini-1.5-pro",
        input_per_m: 1.25,
        output_per_m: 5.0,
    },
    ModelPrice {
        prefix: "gemini-1.5-flash",
        input_per_m: 0.075,
        output_per_m: 0.3,
    },
    ModelPrice {
        prefix: "qwen",
        input_per_m: 0.5,
        output_per_m: 2.0,
    },
];

const FALLBACK_INPUT_PER_M: f64 = 3.0;
const FALLBACK_OUTPUT_PER_M: f64 = 15.0;
const CNY_RATE: f64 = 7.2;

fn model_price(model: &str) -> (f64, f64) {
    for p in MODEL_PRICES {
        if model.starts_with(p.prefix) {
            return (p.input_per_m, p.output_per_m);
        }
    }
    (FALLBACK_INPUT_PER_M, FALLBACK_OUTPUT_PER_M)
}

fn compute_cost(prompt_tokens: i64, completion_tokens: i64, model: &str) -> f64 {
    let (inp, out) = model_price(model);
    (prompt_tokens as f64 / 1_000_000.0 * inp) + (completion_tokens as f64 / 1_000_000.0 * out)
}

impl Db {
    /// Produce everything the Analytics page needs in a single `lock()`.
    /// All timestamps in the DB are Unix ms; `now_ms` is used both for the
    /// 30-day window and for `generated_at` so tests can pin the clock.
    pub fn analytics_summary(
        &self,
        now_ms: i64,
        days: Option<i64>,
    ) -> rusqlite::Result<AnalyticsSummary> {
        let conn = self.conn.lock();

        let since_clause = match days {
            Some(d) => format!("AND created_at >= {}", now_ms - d * 86_400_000),
            None => String::new(),
        };
        let since_m2 = match days {
            Some(d) => format!("AND m2.created_at >= {}", now_ms - d * 86_400_000),
            None => String::new(),
        };

        let sessions: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM sessions WHERE 1=1 {since_clause}"),
            [],
            |r| r.get(0),
        )?;
        let messages: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM messages WHERE 1=1 {since_clause}"),
            [],
            |r| r.get(0),
        )?;
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
            &format!(
                "SELECT COALESCE(SUM(prompt_tokens), 0),
                        COALESCE(SUM(completion_tokens), 0)
                 FROM messages WHERE 1=1 {since_clause}"
            ),
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let total_tokens = prompt_tokens + completion_tokens;

        // T6.1 — lifetime feedback counts.
        let (feedback_up, feedback_down): (i64, i64) = conn.query_row(
            &format!(
                "SELECT COUNT(*) FILTER (WHERE feedback = 'up'),
                            COUNT(*) FILTER (WHERE feedback = 'down')
                     FROM messages WHERE 1=1 {since_clause}"
            ),
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

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

        let mut cost_stmt = conn.prepare(&format!(
            "SELECT COALESCE(NULLIF(s.model, ''), 'unknown') AS m,
                        COALESCE(SUM(m2.prompt_tokens), 0),
                        COALESCE(SUM(m2.completion_tokens), 0)
                 FROM messages m2
                 JOIN sessions s ON m2.session_id = s.id
                 WHERE m2.role = 'assistant' {since_m2}
                 GROUP BY s.model"
        ))?;
        let model_costs: Vec<(String, i64, i64)> = cost_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<_, _>>()?;
        drop(cost_stmt);

        let estimated_cost_usd: f64 = model_costs
            .iter()
            .map(|(m, pt, ct)| compute_cost(*pt, *ct, m))
            .sum();
        let estimated_cost_cny = estimated_cost_usd * CNY_RATE;

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
                estimated_cost_usd,
                estimated_cost_cny,
            },
            messages_per_day,
            tokens_per_day,
            model_usage,
            tool_usage,
            adapter_usage,
            generated_at: now_ms,
        })
    }

    pub fn cost_breakdown(
        &self,
        now_ms: i64,
        days: Option<i64>,
    ) -> rusqlite::Result<CostBreakdown> {
        let conn = self.conn.lock();
        let since_m2 = match days {
            Some(d) => format!("AND m2.created_at >= {}", now_ms - d * 86_400_000),
            None => String::new(),
        };

        let mut stmt = conn.prepare(&format!(
            "SELECT COALESCE(NULLIF(s.model, ''), 'unknown') AS m,
                        COALESCE(SUM(m2.prompt_tokens), 0),
                        COALESCE(SUM(m2.completion_tokens), 0)
                 FROM messages m2
                 JOIN sessions s ON m2.session_id = s.id
                 WHERE m2.role = 'assistant' {since_m2}
                 GROUP BY s.model"
        ))?;
        let by_model: Vec<ModelCost> = stmt
            .query_map([], |row| {
                let model: String = row.get(0)?;
                let pt: i64 = row.get(1)?;
                let ct: i64 = row.get(2)?;
                Ok(ModelCost {
                    cost_usd: compute_cost(pt, ct, &model),
                    model,
                    prompt_tokens: pt,
                    completion_tokens: ct,
                })
            })?
            .collect::<Result<_, _>>()?;
        drop(stmt);

        let total_usd: f64 = by_model.iter().map(|m| m.cost_usd).sum();

        let since_30 = now_ms - 30 * 86_400_000;
        let mut dstmt = conn.prepare(&format!(
            "SELECT date(m2.created_at/1000, 'unixepoch') AS d,
                        SUM(COALESCE(m2.prompt_tokens, 0) + COALESCE(m2.completion_tokens, 0))
                 FROM messages m2
                 JOIN sessions s ON m2.session_id = s.id
                 WHERE m2.role = 'assistant'
                   AND m2.created_at >= ?1 {since_m2}
                 GROUP BY d
                 ORDER BY d"
        ))?;
        let daily_cost: Vec<DayCost> = dstmt
            .query_map(params![since_30], |row| {
                let date: String = row.get(0)?;
                let tokens: i64 = row.get::<_, i64>(1)?;
                Ok(DayCost {
                    cost_usd: tokens as f64 / 1_000_000.0 * FALLBACK_INPUT_PER_M,
                    date,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(CostBreakdown {
            total_usd,
            total_cny: total_usd * CNY_RATE,
            by_model,
            daily_cost,
        })
    }

    pub fn latency_stats(&self, now_ms: i64, days: Option<i64>) -> rusqlite::Result<LatencyStats> {
        let conn = self.conn.lock();
        let since_m2 = match days {
            Some(d) => format!("AND m2.created_at >= {}", now_ms - d * 86_400_000),
            None => String::new(),
        };

        let mut stmt = conn.prepare(&format!(
            "SELECT m2.total_latency_ms
             FROM messages m2
             WHERE m2.role = 'assistant'
               AND m2.total_latency_ms IS NOT NULL {since_m2}
             ORDER BY m2.total_latency_ms"
        ))?;
        let latencies: Vec<i64> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        drop(stmt);

        let p50_ms = percentile(&latencies, 50);
        let p95_ms = percentile(&latencies, 95);
        let p99_ms = percentile(&latencies, 99);
        let avg_ms = if latencies.is_empty() {
            0
        } else {
            latencies.iter().sum::<i64>() / latencies.len() as i64
        };

        let mut mstmt = conn.prepare(&format!(
            "SELECT COALESCE(NULLIF(s.model, ''), 'unknown') AS m,
                    COUNT(*),
                    AVG(m2.total_latency_ms)
             FROM messages m2
             JOIN sessions s ON m2.session_id = s.id
             WHERE m2.role = 'assistant'
               AND m2.total_latency_ms IS NOT NULL {since_m2}
             GROUP BY s.model
             ORDER BY AVG(m2.total_latency_ms) DESC"
        ))?;
        let by_model: Vec<ModelLatency> = mstmt
            .query_map([], |row| {
                Ok(ModelLatency {
                    model: row.get(0)?,
                    count: row.get(1)?,
                    avg_ms: row.get::<_, f64>(2)? as i64,
                    p50_ms: 0,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(LatencyStats {
            p50_ms,
            p95_ms,
            p99_ms,
            avg_ms,
            by_model,
        })
    }

    pub fn error_stats(&self, now_ms: i64, days: Option<i64>) -> rusqlite::Result<ErrorStats> {
        let conn = self.conn.lock();
        let since_clause = match days {
            Some(d) => format!("AND created_at >= {}", now_ms - d * 86_400_000),
            None => String::new(),
        };

        let total_messages: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM messages WHERE 1=1 {since_clause}"),
            [],
            |r| r.get(0),
        )?;

        let total_errors: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM messages WHERE error IS NOT NULL {since_clause}"),
            [],
            |r| r.get(0),
        )?;

        let error_rate = if total_messages > 0 {
            total_errors as f64 / total_messages as f64
        } else {
            0.0
        };

        let since_30 = now_ms - 30 * 86_400_000;
        let mut dstmt = conn.prepare(
            "SELECT date(created_at/1000, 'unixepoch') AS d, COUNT(*) AS cnt
             FROM messages
             WHERE error IS NOT NULL
               AND created_at >= ?1
             GROUP BY d
             ORDER BY d",
        )?;
        let daily_errors: Vec<DayCount> = dstmt
            .query_map(params![since_30], |row| {
                Ok(DayCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        drop(dstmt);

        let mut tstmt = conn.prepare(&format!(
            "SELECT SUBSTR(error, 1, 80) AS e, COUNT(*) AS cnt
             FROM messages
             WHERE error IS NOT NULL {since_clause}
             GROUP BY e
             ORDER BY cnt DESC
             LIMIT 10"
        ))?;
        let top_error_types: Vec<NamedCount> = tstmt
            .query_map([], |row| {
                Ok(NamedCount {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(ErrorStats {
            total_errors,
            total_messages,
            error_rate,
            daily_errors,
            top_error_types,
        })
    }
}

fn percentile(sorted: &[i64], pct: u8) -> i64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((pct as usize) * (sorted.len() - 1)) / 100;
    sorted[idx]
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
            gateway_source: None,
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
            first_token_latency_ms: None,
            total_latency_ms: None,
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
                gateway_source: None,
            })
            .unwrap();
        }
        let summary = db.analytics_summary(10_000, None).unwrap();
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
            gateway_source: None,
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
            gateway_source: None,
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
            first_token_latency_ms: None,
            total_latency_ms: None,
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
            first_token_latency_ms: None,
            total_latency_ms: None,
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
            first_token_latency_ms: None,
            total_latency_ms: None,
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

        let s = db.analytics_summary(now, None).unwrap();
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
        let s = db.analytics_summary(1_000, None).unwrap();
        assert_eq!(s.totals.feedback_up, 2);
        assert_eq!(s.totals.feedback_down, 1);
    }

    #[test]
    fn model_price_matches_known_prefix() {
        let (inp, out) = model_price("deepseek-chat-v3");
        assert!((inp - 0.14).abs() < f64::EPSILON);
        assert!((out - 0.28).abs() < f64::EPSILON);
    }

    #[test]
    fn model_price_falls_back_for_unknown() {
        let (inp, out) = model_price("some-new-model");
        assert!((inp - FALLBACK_INPUT_PER_M).abs() < f64::EPSILON);
        assert!((out - FALLBACK_OUTPUT_PER_M).abs() < f64::EPSILON);
    }

    #[test]
    fn compute_cost_matches_formula() {
        let cost = compute_cost(1_000_000, 1_000_000, "deepseek-chat");
        assert!((cost - (0.14 + 0.28)).abs() < 1e-9);
    }

    #[test]
    fn analytics_summary_includes_cost() {
        let db = Db::open_in_memory().unwrap();
        let day_ms = 86_400_000i64;
        let now = 50 * day_ms;
        db.upsert_session(&SessionRow {
            id: "s1".into(),
            title: "t".into(),
            model: Some("deepseek-chat".into()),
            created_at: now - 5 * day_ms,
            updated_at: now - 5 * day_ms,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "y".into(),
            error: None,
            position: 0,
            created_at: now - 5 * day_ms,
            prompt_tokens: Some(1_000_000),
            completion_tokens: Some(1_000_000),
            feedback: None,
            first_token_latency_ms: None,
            total_latency_ms: None,
        })
        .unwrap();
        let s = db.analytics_summary(now, None).unwrap();
        let expected = 0.14 + 0.28;
        assert!((s.totals.estimated_cost_usd - expected).abs() < 1e-9);
        assert!((s.totals.estimated_cost_cny - expected * CNY_RATE).abs() < 1e-9);
    }

    #[test]
    fn analytics_summary_days_filter_excludes_old() {
        let db = Db::open_in_memory().unwrap();
        let day_ms = 86_400_000i64;
        let now = 100 * day_ms;
        db.upsert_session(&SessionRow {
            id: "s1".into(),
            title: "t".into(),
            model: None,
            created_at: now - 5 * day_ms,
            updated_at: now - 5 * day_ms,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        db.upsert_session(&SessionRow {
            id: "s2".into(),
            title: "t".into(),
            model: None,
            created_at: now - 50 * day_ms,
            updated_at: now - 50 * day_ms,
            adapter_id: "hermes".into(),
            llm_profile_id: None,
            gateway_source: None,
        })
        .unwrap();
        let all = db.analytics_summary(now, None).unwrap();
        assert_eq!(all.totals.sessions, 2);
        let last7 = db.analytics_summary(now, Some(7)).unwrap();
        assert_eq!(last7.totals.sessions, 1);
    }

    #[test]
    fn error_stats_counts_errors_and_rate() {
        let db = Db::open_in_memory().unwrap();
        let now = 100_000_000;
        db.upsert_session(&sample_session("s1", now)).unwrap();
        db.upsert_message(&MessageRow {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "ok".into(),
            error: None,
            position: 0,
            created_at: now,
            prompt_tokens: None,
            completion_tokens: None,
            feedback: None,
            first_token_latency_ms: None,
            total_latency_ms: None,
        })
        .unwrap();
        db.upsert_message(&MessageRow {
            id: "m2".into(),
            session_id: "s1".into(),
            role: "assistant".into(),
            content: "".into(),
            error: Some("rate_limit_exceeded".into()),
            position: 1,
            created_at: now + 1_000,
            prompt_tokens: None,
            completion_tokens: None,
            feedback: None,
            first_token_latency_ms: None,
            total_latency_ms: None,
        })
        .unwrap();
        let stats = db.error_stats(now + 2_000, None).unwrap();
        assert_eq!(stats.total_messages, 2);
        assert_eq!(stats.total_errors, 1);
        assert!((stats.error_rate - 0.5).abs() < 1e-9);
        assert_eq!(stats.top_error_types.len(), 1);
        assert_eq!(stats.top_error_types[0].name, "rate_limit_exceeded");
        assert_eq!(stats.top_error_types[0].count, 1);
    }
}
