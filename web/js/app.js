import '../style/style.css';
import '../style/robot_arm.css';
import { mountManual } from './manual.js';

const manual = mountManual(document.querySelector('#manual-panel'));
const tabs = [...document.querySelectorAll('[role="tab"]')];
const switchElement = document.querySelector('.mode-switch');

function activateTab(index, focus = false) {
  tabs.forEach((tab, tabIndex) => {
    const active = tabIndex === index;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  switchElement.style.setProperty('--active-tab', index);
  document.title = `Robot Arm · ${tabs[index].textContent}`;
  manual.setActive(index === 0);
  if (focus) tabs[index].focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(index));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); activateTab(next, true); }
  });
});
document.querySelector('#back-to-manual').addEventListener('click', () => activateTab(0, true));
document.addEventListener('visibilitychange', () => manual.setActive(!document.hidden && tabs[0].getAttribute('aria-selected') === 'true'));
window.addEventListener('pagehide', event => { if (!event.persisted) manual.dispose(); });
