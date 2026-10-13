const form = document.querySelector('#servo-form');
const button = form.querySelector('button');
const result = document.querySelector('#result');
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity() || button.disabled) return;
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  result.textContent = 'Doelhoek wordt verstuurd…';
  result.dataset.state = 'sending';
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/servo', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({servo: Number(form.elements.servo.value), angle: Number(form.elements.angle.value)}),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Versturen mislukt. Probeer opnieuw.');
    result.textContent = data.message;
    result.dataset.state = 'success';
  } catch (error) {
    result.textContent = error.name === 'AbortError'
      ? 'Geen antwoord van de server. Controleer de verbinding voordat je opnieuw verstuurt.'
      : `Versturen mislukt: ${error.message}`;
    result.dataset.state = 'error';
  } finally {
    clearTimeout(deadline);
    button.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
