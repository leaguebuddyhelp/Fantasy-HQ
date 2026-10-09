(() => {
  const nav = document.querySelector('#primary-nav');
  const toggle = document.querySelector('#mobile-nav-toggle');
  if (!nav || !toggle) return;
  const groups = [...nav.querySelectorAll('.nav-group')];
  groups.forEach(group => group.querySelector('summary').addEventListener('click', () => {
    groups.filter(other => other !== group).forEach(other => { other.open = false; });
  }));
  function closeMenus() { groups.forEach(group => { group.open = false; }); }
  function closeMobile() { nav.dataset.open = 'false'; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); nav.dataset.open = String(open);
    if (!open) closeMenus();
  });
  groups.forEach(group => group.addEventListener('toggle', () => {
    if (group.open) groups.filter(other => other !== group && other.open).forEach(other => { other.open = false; });
  }));
  nav.addEventListener('click', event => { if (event.target.closest('a')) { closeMenus(); closeMobile(); } });
  document.addEventListener('click', event => { if (!event.target.closest('.site-header')) { closeMenus(); closeMobile(); } });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = groups.find(group => group.open);
    if (open) { closeMenus(); open.querySelector('summary').focus(); }
    else if (toggle.getAttribute('aria-expanded') === 'true') { closeMobile(); toggle.focus(); }
  });
  function activate() {
    const hash = location.hash || '#league-home';
    nav.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    groups.forEach(group => group.classList.toggle('is-current', !!group.querySelector('[aria-current]')));
    // Deep links to Staff tools should reveal the login workspace when locked.
    let target;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
    if (target?.hidden && target.closest('#league-admin')) target = document.getElementById('league-admin');
    for (let node = target?.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
  }
  window.addEventListener('hashchange', activate);
  window.addEventListener('resize', () => { if (innerWidth > 1100) { closeMobile(); closeMenus(); } });
  activate();
})();
