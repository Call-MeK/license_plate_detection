// App shell v2: sidebar (thu gọn được) / bottom bar, top bar có ⌘K, menu tài khoản, dialog đổi mật khẩu,
// toast, sheet/dialog, segmented trượt, switch, phím tắt và demo state cho bản preview.
(() => {
  const NAV = [
    { id: 'ops', label: 'Vận hành', icon: 'scan-line', href: '02-van-hanh-xe-vao.html', key: '1' },
    { id: 'alerts', label: 'Cảnh báo', icon: 'bell', href: '04-canh-bao.html', count: 2, key: '2' },
    { id: 'history', label: 'Lịch sử', icon: 'history', href: '05-lich-su.html', key: '3' },
  ];
  const ADMIN = [
    { id: 'users', label: 'Nhân viên', icon: 'users', href: '06-quan-tri-nhan-vien.html' },
    { id: 'pricing', label: 'Biểu phí', icon: 'receipt', href: '07-quan-tri-bieu-phi.html' },
    { id: 'watchlist', label: 'Xe cần cảnh báo', icon: 'shield-alert', href: '08-quan-tri-xe-canh-bao.html' },
    { id: 'audit', label: 'Nhật ký', icon: 'scroll-text', href: '09-quan-tri-nhat-ky.html' },
  ];
  const body = document.body, page = document.getElementById('page');
  const active = body.dataset.nav, sub = body.dataset.sub;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  if (page && active) {
    const link = (n, on) => `
      <a href="${n.href}" ${on ? 'aria-current="page"' : ''} title="${n.label}"
         class="nav-link group flex items-center gap-3 h-9 px-3 rounded-[8px] text-[14px] font-medium transition-colors duration-150
         ${on ? 'bg-surface text-text shadow-[0_1px_2px_rgb(16_24_40/.06)] ring-1 ring-border' : 'text-text-2 hover:bg-muted hover:text-text'}">
        <i data-lucide="${n.icon}" class="${on ? 'text-primary' : ''}"></i><span class="nav-text flex-1 truncate">${n.label}</span>
        ${n.count ? `<span class="count nav-text">${n.count}</span>` : ''}
      </a>`;
    const sidebar = `
      <aside id="sidebar" class="hidden md:flex fixed inset-y-0 left-0 z-30 w-[240px] flex-col bg-subtle border-r border-border transition-[width] duration-200">
        <div class="flex items-center gap-2.5 h-14 px-4 border-b border-border">
          <a href="index.html" class="grid place-items-center w-7 h-7 rounded-[7px] bg-primary text-white shrink-0" aria-label="Mục lục preview"><i data-lucide="square-parking"></i></a>
          <span class="nav-text font-semibold tracking-[-.01em] truncate">ParkSense</span>
          <button id="collapse" class="nav-text btn btn-icon btn-sm ml-auto" aria-label="Thu gọn thanh bên"><i data-lucide="panel-left-close"></i></button>
        </div>
        <nav aria-label="Điều hướng chính" class="flex-1 overflow-y-auto p-3 grid gap-0.5 content-start">
          ${NAV.map(n => link(n, n.id === active)).join('')}
          <p class="nav-text eyebrow px-3 pt-5 pb-2">Quản trị</p>
          ${ADMIN.map(n => link(n, active === 'admin' && n.id === sub)).join('')}
        </nav>
        <div class="p-3 border-t border-border">
          <div class="flex items-center gap-2.5 px-2 py-1.5 rounded-[8px]">
            <span class="avatar primary">A</span>
            <span class="nav-text min-w-0 leading-tight"><span class="block text-[13px] font-medium truncate">admin</span><span class="block text-[12px] text-text-3">Quản trị viên</span></span>
          </div>
        </div>
      </aside>`;
    const bottom = `
      <nav aria-label="Điều hướng chính" class="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 grid grid-cols-4 bg-surface border-t border-border">
        ${[...NAV, { id: 'admin', label: 'Quản trị', icon: 'settings-2', href: ADMIN[0].href }].map(n => `
          <a href="${n.href}" ${n.id === active ? 'aria-current="page"' : ''} class="relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${n.id === active ? 'text-primary' : 'text-text-3'}">
            <i data-lucide="${n.icon}" class="ic-lg"></i>${n.label}
            ${n.count ? `<span class="count absolute top-2 left-1/2 ml-1.5 !h-4 !min-w-4 !text-[10px]">${n.count}</span>` : ''}
          </a>`).join('')}
      </nav>`;
    const crumbs = active === 'admin' ? `<span class="t-meta hidden sm:inline">Quản trị</span><i data-lucide="chevron-right" class="text-text-3 hidden sm:block"></i>` : '';
    const top = `
      <header class="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 md:px-6 bg-[rgb(247_248_250/.85)] backdrop-blur border-b border-border">
        <a href="index.html" class="md:hidden grid place-items-center w-7 h-7 rounded-[7px] bg-primary text-white"><i data-lucide="square-parking"></i></a>
        ${crumbs}<h1 class="text-[15px] font-semibold truncate">${body.dataset.title || ''}</h1>
        <div class="ml-auto flex items-center gap-2">
          <button class="search w-9 sm:w-[260px] justify-center sm:justify-start" data-open="cmdk" aria-label="Tìm biển số">
            <i data-lucide="search"></i><span class="hidden sm:inline flex-1 text-left">Tìm biển số…</span><span class="hidden sm:inline-flex kbd">${isMac ? '⌘' : 'Ctrl'} K</span>
          </button>
          <span class="badge badge-ok hidden lg:inline-flex"><span class="dot"></span>Cổng 1 · trực tuyến</span>
          <div class="relative">
            <button id="acc-btn" class="btn btn-icon" aria-haspopup="menu" aria-expanded="false" aria-label="Tài khoản"><span class="avatar primary !w-7 !h-7">A</span></button>
            <div id="acc-menu" role="menu" class="menu enter right-0 top-11" hidden>
              <div class="px-2.5 py-2"><p class="text-[13px] font-medium">admin</p><p class="t-meta">Quản trị viên</p></div>
              <hr class="divider my-1">
              <button role="menuitem" class="menu-item" data-open="dlg-password"><i data-lucide="key-round"></i>Đổi mật khẩu</button>
              <a role="menuitem" class="menu-item" href="01-dang-nhap.html"><i data-lucide="log-out"></i>Đăng xuất</a>
            </div>
          </div>
        </div>
      </header>`;

    page.className = 'md:pl-[240px] pb-24 md:pb-10 min-h-screen transition-[padding] duration-200';
    page.innerHTML = `${top}<main class="px-4 md:px-6 py-6 max-w-[1400px]">${page.innerHTML}</main>`;
    page.insertAdjacentHTML('beforebegin', sidebar + bottom);
    page.insertAdjacentHTML('afterend', `
      <div id="dlg-password" class="dialog" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <form onsubmit="event.preventDefault()">
          <div class="p-5 pb-4"><h2 id="pw-title" class="h-section">Đổi mật khẩu</h2><p class="t-meta mt-1">Bạn sẽ được đăng xuất khỏi mọi thiết bị sau khi đổi.</p></div>
          <div class="px-5 grid gap-4">
            <div class="field"><label for="pw1">Mật khẩu hiện tại</label><div class="control"><input id="pw1" type="password" autocomplete="current-password"></div></div>
            <div class="field"><label for="pw2">Mật khẩu mới</label><div class="control"><input id="pw2" type="password" autocomplete="new-password" minlength="12"></div><span class="hint">Tối thiểu 12 ký tự</span></div>
          </div>
          <div class="flex justify-end gap-2 p-5"><button type="button" class="btn btn-secondary" data-close>Hủy</button><button class="btn btn-primary" data-toast="Đã đổi mật khẩu">Lưu mật khẩu</button></div>
        </form>
      </div>
      <div id="cmdk" class="dialog cmd" role="dialog" aria-modal="true" aria-label="Tìm biển số">
        <div class="flex items-center gap-3 px-4 h-14 border-b border-border"><i data-lucide="search" class="text-text-3 ic-lg"></i>
          <input id="cmdk-input" class="flex-1 h-full border-0 outline-none bg-transparent text-[15px] placeholder:text-[var(--placeholder)]" placeholder="Nhập biển số, ví dụ 51A-123" value="51A-12">
          <span class="kbd">Esc</span></div>
        <div class="p-2">
          <p class="eyebrow px-2.5 py-2">Xe</p>
          <a href="05-lich-su.html" class="menu-item !h-11"><span class="plate">51A-123.45</span><span class="t-meta flex-1">Đang gửi · vào 11:12</span><i data-lucide="corner-down-left"></i></a>
          <a href="05-lich-su.html" class="menu-item !h-11"><span class="plate">51A-128.45</span><span class="t-meta flex-1">Đã ra hôm qua</span></a>
          <p class="eyebrow px-2.5 py-2 mt-1">Đi tới</p>
          <a href="02-van-hanh-xe-vao.html" class="menu-item"><i data-lucide="log-in"></i>Ghi nhận xe vào</a>
          <a href="03-van-hanh-xe-ra.html" class="menu-item"><i data-lucide="log-out"></i>Ghi nhận xe ra</a>
          <a href="07-quan-tri-bieu-phi.html" class="menu-item"><i data-lucide="receipt"></i>Biểu phí</a>
        </div>
      </div>`);

    // Thu gọn sidebar (nhớ theo trình duyệt)
    const sb = document.getElementById('sidebar');
    const setCollapsed = c => {
      sb.style.width = c ? '64px' : ''; page.style.paddingLeft = c && innerWidth >= 768 ? '64px' : '';
      sb.querySelectorAll('.nav-text').forEach(el => el.hidden = c);
      sb.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('justify-center', c));
      if (c && !document.getElementById('expand')) sb.firstElementChild.insertAdjacentHTML('beforeend', '<button id="expand" class="btn btn-icon btn-sm" aria-label="Mở rộng thanh bên"><i data-lucide="panel-left-open"></i></button>');
      if (!c) document.getElementById('expand')?.remove();
      sb.firstElementChild.classList.toggle('!px-2', c); sb.firstElementChild.querySelector('a').hidden = c;
      icons(); try { localStorage.setItem('sb', c ? '1' : ''); } catch {}
    };
    document.addEventListener('click', e => {
      if (e.target.closest('#collapse')) setCollapsed(true);
      if (e.target.closest('#expand')) setCollapsed(false);
    });
    try { if (localStorage.getItem('sb')) setCollapsed(true); } catch {}

    const accBtn = document.getElementById('acc-btn'), accMenu = document.getElementById('acc-menu');
    accBtn.addEventListener('click', e => { e.stopPropagation(); accMenu.hidden = !accMenu.hidden; accBtn.setAttribute('aria-expanded', String(!accMenu.hidden)); });
    document.addEventListener('click', () => { accMenu.hidden = true; accBtn.setAttribute('aria-expanded', 'false'); });
  }

  document.body.insertAdjacentHTML('beforeend', '<div class="overlay" data-close></div><div class="toasts" aria-live="polite"></div>');

  function icons() { window.lucide?.createIcons(); }

  // ---- Sheet / dialog ----
  const overlay = document.querySelector('.overlay');
  let lastFocus;
  function open(id) {
    close(true);
    const el = document.getElementById(id); if (!el) return;
    lastFocus = document.activeElement;
    el.classList.add('open'); overlay.classList.add('open');
    setTimeout(() => (el.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, select') || el.querySelector('button'))?.focus(), 220);
  }
  function close(silent) {
    const opened = document.querySelectorAll('.sheet.open, .dialog.open');
    opened.forEach(el => el.classList.remove('open'));
    overlay.classList.remove('open');
    if (!silent && opened.length) lastFocus?.focus?.();
  }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); e.stopPropagation(); open(o.dataset.open); return; }
    if (e.target.closest('[data-close]')) close();
  });

  // ---- Toast (xếp chồng, tự ẩn) ----
  const stack = document.querySelector('.toasts');
  function toast(message, action) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<i data-lucide="circle-check"></i><span>${message}</span>${action ? `<button class="btn btn-ghost btn-sm">${action}</button>` : ''}`;
    stack.appendChild(t); icons();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3600);
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-toast]');
    if (t) { toast(t.dataset.toast, t.dataset.toastAction); if (t.closest('.sheet, .dialog')) close(); }
  });

  // ---- Segmented control trượt ----
  function placeThumb(seg) {
    const on = seg.querySelector('button[aria-pressed="true"]'), thumb = seg.querySelector('.thumb');
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`; thumb.style.transform = `translateX(${on.offsetLeft - 3}px)`;
  }
  function initSegs() { document.querySelectorAll('.seg').forEach(seg => { if (!seg.querySelector('.thumb')) seg.insertAdjacentHTML('afterbegin', '<span class="thumb" aria-hidden="true"></span>'); placeThumb(seg); }); }

  document.addEventListener('click', e => {
    const b = e.target.closest('.seg > button');
    if (b) { b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); placeThumb(b.parentElement); }
    const sw = e.target.closest('.switch-row, .switch');
    if (sw) {
      const s = sw.classList.contains('switch') ? sw : sw.querySelector('.switch');
      const v = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', String(v));
      s.dispatchEvent(new CustomEvent('toggle', { bubbles: true, detail: v }));
    }
    const chip = e.target.closest('[data-chips] > .chip');
    if (chip) {
      const g = chip.parentElement;
      if (g.dataset.chips === 'single') g.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
      else chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    }
    const li = e.target.closest('[data-select] > .row-item');
    if (li) li.parentElement.querySelectorAll('.row-item').forEach(x => x.setAttribute('aria-selected', String(x === li)));
  });
  addEventListener('resize', () => document.querySelectorAll('.seg').forEach(placeThumb));

  // ---- Phím tắt: ⌘K, Esc, và [data-kbd] trên nút đang hiển thị ----
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open('cmdk'); return; }
    if (e.key === 'Escape') { close(); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (document.querySelector('.sheet.open, .dialog.open')) return;
    const keyName = e.key === ' ' ? 'Space' : e.key;
    const target = [...document.querySelectorAll(`[data-kbd="${keyName}"]`)].find(el => el.offsetParent && !el.disabled);
    if (target && (!typing || keyName === 'Enter')) { e.preventDefault(); target.click(); }
  });

  // ---- Khung bbox bám theo biển số giả lập ----
  function fitBoxes() {
    document.querySelectorAll('.cam').forEach(cam => {
      const plate = cam.querySelector('.cam-plate'); if (!plate) return;
      const c = cam.getBoundingClientRect(), p = plate.getBoundingClientRect(); if (!p.width) return;
      cam.querySelectorAll('.cam-box').forEach(b => Object.assign(b.style, { left: `${p.left - c.left - 6}px`, top: `${p.top - c.top - 6}px`, width: `${p.width + 12}px`, height: `${p.height + 12}px` }));
      cam.querySelectorAll('.cam-label').forEach(l => { l.style.top = `${p.top - c.top - 38}px`; });
    });
  }
  addEventListener('resize', fitBoxes);

  // ---- Demo state ----
  const states = window.DEMO_STATES || {};
  function go(state) {
    body.dataset.demo = state;
    document.querySelectorAll('[data-show]').forEach(el => { el.hidden = !el.dataset.show.split(/\s+/).includes(state); });
    const step = states[state]?.step;
    if (step) document.querySelectorAll('.step[data-index]').forEach(el => {
      const i = +el.dataset.index; el.dataset.state = i < step ? 'done' : i === step ? 'current' : 'todo';
    });
    document.querySelectorAll('.demo-bar [data-goto]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.goto === state)));
    states[state]?.onEnter?.();
    requestAnimationFrame(() => { fitBoxes(); initSegs(); });
  }
  document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g && !g.disabled) { e.preventDefault(); go(g.dataset.goto); } });

  icons(); initSegs();
  const first = Object.keys(states)[0]; if (first) go(first);
  addEventListener('load', () => { fitBoxes(); initSegs(); });
  document.fonts?.ready.then(() => { fitBoxes(); initSegs(); });

  window.Shell = { open, close, toast, go, icons };
})();
