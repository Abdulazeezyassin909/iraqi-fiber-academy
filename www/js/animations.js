(function () {
  'use strict';

  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  function reobserveAnimations(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll
      ? scope.querySelectorAll('.fade-in:not(.visible)')
      : [];
    if (root && root.classList && root.classList.contains('fade-in') && !root.classList.contains('visible')) {
      revealObserver.observe(root);
    }
    Array.prototype.forEach.call(nodes, function (el) {
      revealObserver.observe(el);
    });
  }

  window.reobserveAnimations = reobserveAnimations;

  reobserveAnimations(document);

  var statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
  var statsHydrated = false;
  var statsSectionVisible = false;
  var statsSection = document.getElementById('stats');

  function formatCounterValue(value, suffix) {
    if (window.PlatformStats && typeof window.PlatformStats.formatStatNumber === 'function') {
      return window.PlatformStats.formatStatNumber(value) + (suffix || '');
    }
    var n = Math.round(Number(value) || 0);
    var formatted = n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return formatted + (suffix || '');
  }

  function parseDisplayedValue(element) {
    var raw = (element.textContent || '').replace(/[^\d]/g, '');
    var n = parseInt(raw, 10);
    return isFinite(n) ? n : 0;
  }

  function getCounterSuffix(element) {
    var suffix = element.getAttribute('data-stat-suffix') || '';
    if (
      suffix === '%' ||
      element.getAttribute('data-stat-key') === 'satisfactionRate'
    ) {
      return '%';
    }
    return '';
  }

  function animateCounter(element, fromValue) {
    var target = parseInt(element.getAttribute('data-target'), 10);
    if (!isFinite(target)) return;

    var suffix = getCounterSuffix(element);
    var start = fromValue != null ? fromValue : 0;
    if (start === target) {
      element.textContent = formatCounterValue(target, suffix);
      element.setAttribute('data-counter-done', '1');
      return;
    }

    var duration = start === 0 ? 2000 : 1200;
    var startTime = performance.now();

    function updateCounter(currentTime) {
      var progress = Math.min((currentTime - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.floor(start + (target - start) * eased);
      element.textContent = formatCounterValue(current, suffix);
      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      } else {
        element.textContent = formatCounterValue(target, suffix);
        element.setAttribute('data-counter-done', '1');
      }
    }

    element.removeAttribute('data-counter-done');
    requestAnimationFrame(updateCounter);
  }

  function refreshStatNodeList() {
    statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
  }

  function startStatCounters() {
    if (!statsHydrated) return;
    refreshStatNodeList();
    if (!statNumbers.length) return;

    Array.prototype.forEach.call(statNumbers, function (el) {
      if (el.getAttribute('data-counter-done') === '1') return;
      animateCounter(el, 0);
    });
  }

  function updateStatCountersFromChange() {
    if (!statsHydrated) return;
    refreshStatNodeList();
    Array.prototype.forEach.call(statNumbers, function (el) {
      var target = parseInt(el.getAttribute('data-target'), 10);
      if (!isFinite(target)) return;
      var current = parseDisplayedValue(el);
      if (current === target && el.getAttribute('data-counter-done') === '1') return;
      animateCounter(el, current);
    });
  }

  function onStatsHydrated() {
    statsHydrated = true;
    if (statsSection) statsSection.classList.remove('stats--loading');
    if (window.PlatformStats && typeof window.PlatformStats.applyLandingStats === 'function') {
      window.PlatformStats.applyLandingStats(document);
    }
    if (statsSectionVisible) {
      startStatCounters();
    }
  }

  window.addEventListener('ifa:platform-stats-hydrated', onStatsHydrated);

  window.addEventListener('ifa:platform-stats-changed', function () {
    if (!statsHydrated) return;
    updateStatCountersFromChange();
  });

  window.addEventListener('ifa:platform-user-metrics-changed', function () {
    if (!statsHydrated) return;
    if (window.PlatformStats && typeof window.PlatformStats.applyLandingStats === 'function') {
      window.PlatformStats.applyLandingStats(document);
    }
    updateStatCountersFromChange();
  });

  if (statsSection) {
    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          statsSectionVisible = true;
          if (statsHydrated) startStatCounters();
        }
      });
    }, { threshold: 0.3 });
    statsObserver.observe(statsSection);
  }

  if (window.PlatformStats && typeof window.PlatformStats.isHydrated === 'function' && window.PlatformStats.isHydrated()) {
    onStatsHydrated();
  }

  function staggerChildren(parentSelector, childSelector, delay) {
    document.querySelectorAll(parentSelector).forEach(function (parent) {
      parent.querySelectorAll(childSelector).forEach(function (child, index) {
        child.style.transitionDelay = index * delay + 'ms';
      });
    });
  }

  staggerChildren('.features__grid', '.feature-card', 100);
  staggerChildren('.testimonials__grid', '.testimonial-card', 150);
  staggerChildren('.pricing__grid', '.pricing-card', 120);
  staggerChildren('.faq__list', '.faq-item', 80);

  document.addEventListener('DOMContentLoaded', function () {
    reobserveAnimations(document);
    if (window.PlatformStats && typeof window.PlatformStats.isHydrated === 'function' && window.PlatformStats.isHydrated()) {
      onStatsHydrated();
    }
  });
  window.addEventListener('load', function () {
    reobserveAnimations(document);
    if (window.PlatformStats && typeof window.PlatformStats.isHydrated === 'function' && window.PlatformStats.isHydrated()) {
      onStatsHydrated();
    }
  });
})();
