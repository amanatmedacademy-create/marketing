function relabelMessagingUnanswered(): void {
  const root = document.querySelector('.callcenter-root');
  if (!root) return;

  root.querySelectorAll<HTMLButtonElement>('.inbox-queue-tabs button').forEach((button) => {
    if (button.textContent?.trim() === 'Ожидают') button.textContent = 'Без ответа';
  });

  root.querySelectorAll<HTMLElement>('.messaging-kpis article small').forEach((label) => {
    if (label.textContent?.trim() === 'Ожидают') label.textContent = 'Без ответа';
  });
}

if (typeof window !== 'undefined') {
  relabelMessagingUnanswered();
  const observer = new MutationObserver(() => window.requestAnimationFrame(relabelMessagingUnanswered));
  observer.observe(document.documentElement, { subtree: true, childList: true });
}
