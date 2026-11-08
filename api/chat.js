
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const ALLOWED_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant"
]);

const rateLimits = new Map();

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

const tools = [{
  type: "function",
  function: {
    name: "create_calendar_events",
    description: "Create one or more events in the user's existing Jarvis calendar. Use this when the user clearly asks to add, schedule, or put commitments in their calendar. Only include events with clear dates, start times and end times. Ask the user for missing essential details instead of guessing.",
    parameters: {
      type: "object",
      properties: {
        events: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start: {
                type: "string",
                description: "Local date and time in YYYY-MM-DDTHH:mm format."
              },
              end: {
                type: "string",
                description: "Local date and time in YYYY-MM-DDTHH:mm format."
              },
              location: { type: "string" },
              notes: { type: "string" }
            },
            required: ["title", "start", "end"],
            additionalProperties: false
          }
        }
      },
      required: ["events"],
      additionalProperties: false
    }
  }
}];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Jarvis AI",
      provider: "Groq",
      keyConfigured: Boolean(process.env.GROQ_API_KEY)
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendError(res, 405, "Method not allowed.");
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return sendError(res, 500, "GROQ_API_KEY is missing. Add it in Vercel Environment Variables, then redeploy.");
  }

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateLimits.get(ip) || []).filter(t => now - t < 60_000);

  if (recent.length >= 20) {
    return sendError(res, 429, "Too many requests. Wait a minute and try again.");
  }

  recent.push(now);
  rateLimits.set(ip, recent);

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  if (!body || !Array.isArray(body.messages) ||
      body.messages.length < 1 || body.messages.length > 30) {
    return sendError(res, 400, "Invalid request. Please refresh and try again.");
  }

  const messages = [];

  for (const message of body.messages) {
    if (!message || !["user", "assistant", "tool"].includes(message.role)) {
      return sendError(res, 400, "One of the messages is invalid.");
    }

    if (message.role === "tool") {
      if (typeof message.content !== "string" ||
          typeof message.tool_call_id !== "string") {
        return sendError(res, 400, "Invalid tool response.");
      }

      messages.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content.slice(0, 5000)
      });
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: message.tool_calls
      });
      continue;
    }

    if (typeof message.content !== "string" || message.content.length > 8000) {
      return sendError(res, 400, "One of the messages is invalid or too long.");
    }

    messages.push({
      role: message.role,
      content: message.content
    });
  }

  const requestedModel = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const tone = ["direct", "detailed", "concise"].includes(body.tone)
    ? body.tone : "direct";

  const toneText = {
    direct: "Be direct, practical and clear. Avoid waffle.",
    detailed: "Give useful detail and explain your reasoning clearly.",
    concise: "Keep answers short and focused."
  }[tone];

  const context = JSON.stringify(body.context || {}).slice(0, 12000);

  const currentTime = new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "full",
    timeStyle: "short"
  });

  const systemPrompt = `You are Jarvis, a capable personal AI assistant.
Current local time in Adelaide, South Australia: ${currentTime}.
${toneText}

Help the user plan their day, organise tasks, study, manage projects and get things done.

CALENDAR ACTIONS:
You have access to the create_calendar_events tool.
When the user clearly asks you to add or schedule events, use the tool.
You may add multiple events in one tool call.
Only create events when their title, date, start time and end time are clear.
Never invent dates, times or durations.
If an end time is missing, ask the user instead of guessing.
If the user describes a recurring commitment without a clear end date, ask how far ahead they want it added.
Use the supplied timezone and current date when interpreting dates.
Use local date/time strings in YYYY-MM-DDTHH:mm format.
Check existing events for obvious clashes and duplicates before requesting creation.
Do not say an event has been added until the tool result confirms it.
After a successful tool result, tell the user exactly what was saved.
If an event was skipped because of a conflict or duplicate, explain that clearly.

For normal questions, answer normally without calling a tool.
Never invent an event, deadline, result or personal detail.
Do not schedule over school or sleep without the user's instruction.
The user may be a teenager. Keep health, fitness and training advice age-appropriate.
Keep private information private. Never ask for passwords or API keys.

JARVIS WORKSPACE DATA (JSON):
${context}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        tool_choice: "auto",
        temperature: 0.3,
        max_completion_tokens: 1800
      }),
      signal: controller.signal
    });

    const payload = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message = payload?.error?.message ||
        `Groq returned an error (${upstream.status}).`;
      console.error("Groq API error:", upstream.status, message);
      return sendError(res, upstream.status === 429 ? 429 : 502, message);
    }

    const assistantMessage = payload?.choices?.[0]?.message;

    if (!assistantMessage) {
      return sendError(res, 502, "Groq returned an empty response. Try again.");
    }

    return res.status(200).json({
      reply: typeof assistantMessage.content === "string"
        ? assistantMessage.content.trim() : "",
      toolCalls: Array.isArray(assistantMessage.tool_calls)
        ? assistantMessage.tool_calls : [],
      model: payload.model || model
    });

  } catch (error) {
    console.error("Jarvis AI handler failed:", error?.stack || error?.message);

    if (error.name === "AbortError") {
      return sendError(res, 504, "The AI request timed out. Try again.");
    }

    return sendError(res, 500, "Jarvis server error. Check the Vercel function logs.");
  } finally {
    clearTimeout(timeout);
  }
};
