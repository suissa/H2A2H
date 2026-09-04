(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(open));
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        menuButton.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const revealItems = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });

    revealItems.forEach((item, index) => {
      item.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
      revealObserver.observe(item);
    });
  }

  const sections = [...document.querySelectorAll('main section[id]')];
  const navLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;
      const id = visible.target.id;
      navLinks.forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }, { threshold: [0.25, 0.45, 0.65], rootMargin: '-18% 0px -52% 0px' });

    sections.forEach((section) => sectionObserver.observe(section));
  }

  const canvas = document.getElementById('ambient-canvas');
  if (!canvas || reduceMotion) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let points = [];
  let raf = 0;

  const palette = [
    [38, 181, 255],
    [104, 135, 255],
    [171, 78, 255]
  ];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(22, Math.min(58, Math.round((width * height) / 36000)));
    points = Array.from({ length: count }, (_, i) => {
      const color = palette[i % palette.length];
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.11,
        vy: (Math.random() - 0.5) * 0.08,
        r: 0.7 + Math.random() * 1.1,
        color
      };
    });
  }

  function drawPoint(point) {
    const [r, g, b] = point.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},0.42)`;
    ctx.fill();
  }

  function connectPoints(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = width < 700 ? 105 : 145;
    if (distance > maxDistance) return;

    const alpha = (1 - distance / maxDistance) * 0.08;
    const mix = a.x < width / 2 ? [38, 181, 255] : [171, 78, 255];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(${mix[0]},${mix[1]},${mix[2]},${alpha})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);

    points.forEach((point, i) => {
      point.x += point.vx;
      point.y += point.vy;

      if (point.x < -10) point.x = width + 10;
      if (point.x > width + 10) point.x = -10;
      if (point.y < -10) point.y = height + 10;
      if (point.y > height + 10) point.y = -10;

      drawPoint(point);
      for (let j = i + 1; j < points.length; j += 1) {
        connectPoints(point, points[j]);
      }
    });

    raf = requestAnimationFrame(frame);
  }

  resize();
  frame();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      cancelAnimationFrame(raf);
      frame();
    }
  });
})();
