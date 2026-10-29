(function () {
  var views = {
    home: document.getElementById('view-home'),
    courses: document.getElementById('view-courses'),
    simulators: document.getElementById('view-simulators'),
    'my-courses': document.getElementById('view-my-courses'),
    profile: document.getElementById('view-profile'),
    'auth-required': document.getElementById('view-auth-required'),
  };

  function currentUser() {
    var auth = window.IFAAuth;
    if (auth && typeof auth.getLocalAuthUser === 'function') {
      var user = auth.getLocalAuthUser();
      if (user && user.email) return user;
    }
    try {
      var parsed = JSON.parse(localStorage.getItem('ifa_auth_user') || 'null');
      if (parsed && parsed.email) return parsed;
    } catch (err) {
      return null;
    }
    return null;
  }

  function isLoggedIn() {
    return !!currentUser();
  }

  function readCourses() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getCourses === 'function') {
      return window.PlatformCourses.getCourses();
    }
    try {
      return JSON.parse(localStorage.getItem('platform_courses') || '[]');
    } catch (err) {
      return [];
    }
  }

  function progressFor(course) {
    var lessons = Array.isArray(course.lessons) && course.lessons.length ? course.lessons.length : 8;
    var done = 0;
    try {
      var map = JSON.parse(localStorage.getItem('ifa_course_progress') || '{}');
      var entry = map[course.id];
      if (entry && entry.completed != null) done = Number(entry.completed) || 0;
    } catch (err) {
      done = 0;
    }
    if (done < 0) done = 0;
    if (done > lessons) done = lessons;
    return { done: done, lessons: lessons, pct: Math.round((done / lessons) * 100) };
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function fillProfile() {
    var user = currentUser();
    var email = (user && user.email) || 'abdulazizyassin909@gmail.com';
    var name = (user && (user.name || user.displayName)) || email.split('@')[0] || 'الطالب';
    var emailEl = document.getElementById('profileEmail');
    var nameEl = document.getElementById('profileName');
    var avatar = document.getElementById('profileAvatar');
    if (emailEl) emailEl.textContent = email;
    if (nameEl) nameEl.textContent = name;
    if (avatar) avatar.textContent = String(name).trim().charAt(0) || 'أ';
  }

  function fillMyCourses() {
    var list = document.getElementById('myCoursesList');
    if (!list) return;
    var user = currentUser();
    var ids = user && Array.isArray(user.enrolledCourseIds) ? user.enrolledCourseIds.map(String) : [];
    var courses = readCourses().filter(function (course) {
      return ids.indexOf(String(course.id)) !== -1;
    });
    if (!courses.length) {
      list.innerHTML = '<p class="progress-label">لا توجد دورات مسجّلة بعد.</p>';
      return;
    }
    list.innerHTML = courses
      .map(function (course) {
        var progress = progressFor(course);
        var image = course.imageUrl || course.thumbnailUrl || '';
        var thumb = image ? '<img class="my-course-card__thumb" src="' + esc(image) + '" alt="" />' : '';
        return (
          '<article class="my-course-card">' +
          thumb +
          '<h3>' + esc(course.title || 'كورس') + '</h3>' +
          '<div class="progress-row">' +
          '<div class="progress progress-bar"><div class="bar progress-fill" style="width:' + progress.pct + '%"></div></div>' +
          '<span class="progress-label">' + progress.pct + '% مكتمل · ' + progress.done + '/' + progress.lessons + ' دروس</span>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function switchView(viewId) {
    var tab = String(viewId || 'view-home').replace(/^view-/, '');
    var loggedIn = isLoggedIn();
    var target = tab;
    if ((tab === 'profile' || tab === 'my-courses') && !loggedIn) target = 'auth-required';
    var scrollToSimulators = tab === 'simulators';
    if (scrollToSimulators) target = 'home';
    Object.keys(views).forEach(function (key) {
      var el = views[key];
      if (!el) return;
      el.classList.toggle('active', key === target);
    });
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.classList.toggle('is-active', item.getAttribute('data-view') === tab);
    });
    var footer = document.getElementById('footer');
    if (footer) footer.hidden = target !== 'home' && window.matchMedia('(max-width: 768px)').matches;
    if (target === 'profile') fillProfile();
    if (target === 'my-courses') fillMyCourses();
    if (scrollToSimulators) {
      var simulators = document.getElementById('simulators');
      if (simulators) {
        window.requestAnimationFrame(function () {
          var header = document.getElementById('header');
          var offset = header ? header.offsetHeight : 72;
          window.scrollTo({
            top: simulators.getBoundingClientRect().top + window.scrollY - offset,
            behavior: 'smooth',
          });
        });
      }
      return;
    }
    window.scrollTo(0, 0);
  }

  window.switchView = switchView;
  window.switchTab = function (tab) { switchView('view-' + tab); };

  function handleBottomNavClick(viewId, navElement) {
    document.querySelectorAll('.app-view').forEach(function (view) {
      view.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.classList.remove('is-active');
    });
    switchView(viewId);
    if (navElement) navElement.classList.add('is-active');
  }

  function bindBottomNav() {
    document.querySelectorAll('.mobile-bottom-nav .nav-item').forEach(function (item) {
      item.addEventListener('click', function (event) {
        event.preventDefault();
        var viewName = item.getAttribute('data-view') || 'home';
        handleBottomNavClick('view-' + viewName, item);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBottomNav);
  } else {
    bindBottomNav();
  }
})();
