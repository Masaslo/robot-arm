const servoIds = ['0', '1', '2', '3', '4', '5'];

export async function sendAngles(anglesDeg, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!anglesDeg || typeof anglesDeg !== 'object' || Array.isArray(anglesDeg) ||
      Reflect.ownKeys(anglesDeg).length !== 6 || !servoIds.every(id =>
        Object.hasOwn(anglesDeg, id) && Number.isInteger(anglesDeg[id]) && anglesDeg[id] >= 0 && anglesDeg[id] <= 180)) {
    throw new Error('Geef precies zes servo-ID’s (0–5) met gehele hoeken van 0–180° op.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Deze browser kan geen verbinding met de arm maken.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new Error('De tijdslimiet moet een positief, eindig aantal milliseconden zijn.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    let text;
    try {
      response = await fetchImpl('/api/arm/angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anglesDeg }),
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      if (controller.signal.aborted) throw new Error('Geen antwoord binnen de tijdslimiet. Probeer later opnieuw.');
      throw new Error('Verbinding met de arm mislukt. Controleer het netwerk.');
    }
    let data = null;
    if (text.trim()) {
      try { data = JSON.parse(text); } catch { /* Empty or non-JSON bodies have a readable fallback. */ }
    }
    if (!response.ok) {
      const message = typeof data?.error === 'string' && data.error.trim() ? data.error :
        typeof data?.message === 'string' && data.message.trim() ? data.message :
          `De arm heeft de aanvraag geweigerd (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return {
      message: typeof data?.message === 'string' && data.message.trim() ? data.message :
        'Doel geaccepteerd. De beweging kan nog bezig zijn.',
    };
  } finally {
    clearTimeout(timer);
  }
}
