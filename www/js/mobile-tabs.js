(function () {
  var main = document.querySelector('main');
  var profile = document.getElementById('profileView');
  var mine = document.getElementById('myCoursesView');
  var authView = document.getElementById('authRequiredView');
  var list = document.getElementById('myCoursesList');

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

  function setOpen(el, open) {
    if (!el) return;
    el.hidden = !open;
    el.classList.toggle('is-open', open);
  }

  function markTab(tab) {
    document.querySelectorAll('[data-mobile-tab]').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-mobile-tab') === tab);
    });
  }

  function fillProfile() {
    var user = currentUser();
    var email = (user && (user.email || user.mail)) || 'abdulazizyassin909@gmail.com';
    var name = (user && (user.name || user.displayName)) || email.split('@')[0] || 'الطالب';
    var emailEl = document.getElementById('profileEmail');
    var nameEl = document.getElementById('profileName');
    var avatar = document.getElementById('profileAvatar');
    if (emailEl) emailEl.textContent = email;
    if (nameEl) nameEl.textContent = name;
    if (avatar) {
      if (user && user.photoURL) {
        avatar.innerHTML = '<img src="' + String(user.photoURL).replace(/"/g, '') + '" alt="" />';
      } else {
        avatar.textContent = String(name).trim().charAt(0) || 'أ';
      }
    }
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

  function fillMyCourses() {
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
        var thumb = image
          ? '<img class="my-course-card__thumb" src="' + esc(image) + '" alt="" />'
          : '';
        return (
          '<article class="my-course-card">' +
          thumb +
          '<h3>' + esc(course.title || 'كورس') + '</h3>' +
          '<div class="progress-row">' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + progress.pct + '%"></div></div>' +
          '<span class="progress-label">' + progress.pct + '% مكتمل · ' + progress.done + '/' + progress.lessons + ' دروس</span>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function switchTab(tab) {
    var needsAuth = tab === 'profile' || tab === 'my-courses';
    var loggedIn = isLoggedIn();
    var showMain = tab === 'home' || tab === 'courses';
    if (main) main.hidden = !showMain;
    var footer = document.getElementById('footer');
    if (footer) footer.hidden = !showMain;
    setOpen(profile, tab === 'profile' && loggedIn);
    setOpen(mine, tab === 'my-courses' && loggedIn);
    setOpen(authView, needsAuth && !loggedIn);
    if (tab === 'profile' && loggedIn) fillProfile();
    if (tab === 'my-courses' && loggedIn) fillMyCourses();
    markTab(tab);
    if (showMain) window.scrollTo(0, tab === 'courses' ? 0 : 0);
    if (tab === 'courses') {
      var courses = document.getElementById('courses');
      if (courses && courses.scrollIntoView) courses.scrollIntoView();
    }
  }

  window.switchTab = switchTab;

  document.querySelectorAll('[data-mobile-tab]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var tab = link.getAttribute('data-mobile-tab');
      if (tab === 'profile' || tab === 'my-courses') event.preventDefault();
      switchTab(tab);
    });
  });

  switchTab('home');
})();
