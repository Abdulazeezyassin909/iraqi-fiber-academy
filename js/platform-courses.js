/**
 * Unified platform courses database (localStorage).
 * Shared by Admin, Instructor panel, and public homepage.
 * Primary key: platform_courses
 * Migrates legacy: ifa_platform_courses + instructor-local courses.
 */
(function (global) {
  'use strict';

  var COURSES_KEY = 'platform_courses';
  var LEGACY_KEY = 'ifa_platform_courses';
  var SEED_VERSION_KEY = 'platform_courses_seed_version';
  var SEED_VERSION = '3';
  var INSTRUCTOR_CONTENT_KEY = 'ifa_instructor_content';

  var ACADEMY_EMAIL = '';
  var ACADEMY_NAME = 'مسار المهندس ‎°360';

  var VALID_STATUS = { draft: true, published: true, suspended: true, pending: true };
  var VALID_CATEGORY = { individual: true, program: true, master: true };

  var INDIVIDUAL_MODULE_TITLES = [
    'أساسيات الألياف الضوئية',
    'أساسيات FTTH',
    'المعدات والأدوات الميدانية',
    'توزيع الكيبلات والبنية التحتية',
    'Fusion Splicing & Closures',
    'Power Meter & VFL',
    'OTDR Professional',
    'QGIS L1',
    'QGIS L2',
    'QGIS L3',
    'QC & Inspection Engineering',
    'Troubleshooting & Maintenance',
  ];

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid(prefix) {
    return (prefix || 'course') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error('[PlatformCourses] set failed', key, err);
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function normalizeStatus(status) {
    var s = String(status || 'draft').toLowerCase();
    return VALID_STATUS[s] ? s : 'draft';
  }

  function normalizeCategory(category) {
    var c = String(category || '').toLowerCase();
    return VALID_CATEGORY[c] ? c : 'individual';
  }

  function normalizeCurrency(value) {
    var raw = String(value || '').trim();
    var key = raw.toUpperCase();
    if (key === 'USD' || key === '$' || key === 'DOLLAR' || raw === 'دولار') return 'USD';
    if (
      key === 'IQD' ||
      raw === 'د.ع' ||
      raw === 'د.ع.' ||
      key === 'IQD' ||
      raw === 'ر.س' ||
      key === 'SAR'
    ) {
      return 'IQD';
    }
    return 'IQD';
  }

  function currencyLabel(code) {
    return normalizeCurrency(code) === 'USD' ? '$' : 'د.ع';
  }

  function parsePrice(val) {
    if (typeof val === 'number' && isFinite(val)) return val < 0 ? 0 : val;
    var clean = String(val == null ? '' : val)
      .replace(/,/g, '')
      .replace(/٬/g, '')
      .replace(/،/g, '')
      .replace(/\s/g, '')
      .trim();
    if (!clean) return 0;
    var n = Number(clean);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  function formatGroupedAmount(val) {
    var n = parsePrice(val);
    if (!n) return '0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function isAcademyAssignment(email, name) {
    var key = normalizeEmail(email);
    if (!key) return true;
    var n = String(name || '').trim();
    return n === ACADEMY_NAME || key === 'academy' || key === '__academy__';
  }

  function lessonsFromTitles(titles) {
    return (titles || []).map(function (title, index) {
      return {
        id: 'lesson_mod_' + (index + 1),
        title: title,
        description: '',
        videoId: '',
        videoUrl: '',
        videoFileName: '',
        isFreePreview: false,
        order: index + 1,
        createdAt: new Date().toISOString(),
      };
    });
  }

  function buildPresets() {
    var individuals = [
      {
        id: 'preset_fiber_basics',
        title: 'أساسيات الألياف الضوئية',
        description:
          'مبادئ الضوء، أنواع الألياف (SM/MM)، الموجات الطولية، ومكوّنات الكابلات البصرية الأساسية.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_ftth_basics',
        title: 'أساسيات FTTH',
        description: 'مقدمة في شبكات FTTH ومعمارية GPON/EPON ومسار الإشارة من OLT إلى ONT.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_field_tools',
        title: 'المعدات والأدوات الميدانية',
        description: 'التعرّف على الأدوات الميدانية واستخدامها الآمن في أعمال الألياف الضوئية.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_cable_infra',
        title: 'توزيع الكيبلات والبنية التحتية',
        description: 'تخطيط مسارات الكيبلات، المجاري، والصناديق والبنية التحتية لشبكات FTTH.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_fusion_splicing',
        title: 'Fusion Splicing & Closures',
        description: 'لحام الألياف الضوئية وإدارة الـ Closures ومعايير جودة اللحام.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_power_vfl',
        title: 'Power Meter & VFL',
        description: 'قياس القدرة البصرية وتتبع الأعطال باستخدام Power Meter و VFL.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_otdr_pro',
        title: 'OTDR Professional',
        description: 'قراءة وتحليل منحنيات OTDR وتحديد مواقع الأعطال والخسائر باحتراف.',
        durationHours: 28,
        durationWeeks: 3,
      },
      {
        id: 'preset_qgis_l1',
        title: 'QGIS L1',
        description: 'أساسيات نظم المعلومات الجغرافية وتطبيقات QGIS لمشاريع FTTH.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_qgis_l2',
        title: 'QGIS L2',
        description: 'تحليل الطبقات، الرقمنة، وإعداد خرائط شبكات FTTH المتقدمة في QGIS.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_qgis_l3',
        title: 'QGIS L3',
        description: 'نمذجة شبكات FTTH المتقدمة، التقارير الهندسية، وسير عمل GIS الاحترافي.',
        durationHours: 28,
        durationWeeks: 3,
      },
      {
        id: 'preset_qc_inspection',
        title: 'QC & Inspection Engineering',
        description: 'هندسة الجودة والفحص الميداني ومعايير القبول في مشاريع الألياف.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_troubleshooting',
        title: 'Troubleshooting & Maintenance',
        description: 'تشخيص أعطال الشبكات البصرية وخطط الصيانة والتشغيل المستمر.',
        durationHours: 24,
        durationWeeks: 3,
      },
    ].map(function (p) {
      return Object.assign({}, p, {
        category: 'individual',
        categoryLabel: 'الكورسات المنفردة',
        weeklySchedule: 'جلستان أسبوعياً',
        lessons: lessonsFromTitles([p.title]),
        status: 'draft',
        source: 'admin',
        instructorEmail: ACADEMY_EMAIL,
        instructorName: ACADEMY_NAME,
      });
    });

    var programs = [
      {
        id: 'preset_prog_fiber_optics',
        title: 'Fiber Optics Professional Program (فني أو مهندس FTTH ميداني)',
        description:
          'برنامج احترافي ميداني يغطي أساسيات الألياف وFTTH والمعدات والتوزيع واللحام.',
        moduleIndexes: [0, 1, 2, 3, 4],
        durationHours: 80,
        durationWeeks: 8,
      },
      {
        id: 'preset_prog_fiber_testing',
        title: 'Fiber Testing Professional Program (مهندس فحص واختبارات ألياف ضوئية)',
        description: 'برنامج متخصص في Power Meter وVFL وOTDR وفحص الجودة الميداني.',
        moduleIndexes: [5, 6, 10],
        durationHours: 64,
        durationWeeks: 6,
      },
      {
        id: 'preset_prog_ftth_gis',
        title: 'FTTH GIS Professional Program (مصمم شبكات FTTH باستخدام GIS)',
        description: 'برنامج تصميم شبكات FTTH باستخدام QGIS من المستوى الأول حتى الثالث.',
        moduleIndexes: [7, 8, 9],
        durationHours: 72,
        durationWeeks: 7,
      },
      {
        id: 'preset_prog_ftth_ops',
        title: 'FTTH Operations Professional Program (مهندس جودة وصيانة وتشغيل)',
        description: 'برنامج تشغيل وصيانة يشمل QC والفحص والصيانة واستكشاف الأعطال.',
        moduleIndexes: [10, 11, 5, 6],
        durationHours: 68,
        durationWeeks: 7,
      },
    ].map(function (p) {
      var titles = p.moduleIndexes.map(function (i) {
        return INDIVIDUAL_MODULE_TITLES[i];
      });
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        category: 'program',
        categoryLabel: 'البرامج الاحترافية المجمعة',
        durationHours: p.durationHours,
        durationWeeks: p.durationWeeks,
        weeklySchedule: 'ثلاث جلسات أسبوعياً',
        lessons: lessonsFromTitles(titles),
        status: 'draft',
        source: 'admin',
        instructorEmail: ACADEMY_EMAIL,
        instructorName: ACADEMY_NAME,
      };
    });

    var master = {
      id: 'preset_master_ftth',
      title: 'FTTH Master Professional Program (FTTH Master Engineer)',
      description:
        'الكورس الشامل لمهندس FTTH Master — يشمل جميع الوحدات الـ 12 من الأساسيات حتى التشغيل والصيانة.',
      category: 'master',
      categoryLabel: 'الكورس الشامل',
      durationHours: 160,
      durationWeeks: 16,
      weeklySchedule: 'مسار شامل — وحدات أسبوعية متتابعة',
      lessons: lessonsFromTitles(INDIVIDUAL_MODULE_TITLES),
      status: 'draft',
      source: 'admin',
      instructorEmail: ACADEMY_EMAIL,
      instructorName: ACADEMY_NAME,
    };

    return individuals.concat(programs, [master]);
  }

  var COURSE_PRESETS = buildPresets();

  function normalizeQuizQuestions(questions) {
    if (!Array.isArray(questions)) return [];
    return questions
      .map(function (q) {
        if (!q || typeof q !== 'object') return null;
        var options = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
        while (options.length < 4) options.push('');
        options = options.map(function (o) {
          return String(o == null ? '' : o).trim();
        });
        var text = String(q.text || q.question || '').trim();
        if (!text) return null;
        var correctIndex = Number(q.correctIndex);
        if (!isFinite(correctIndex) || correctIndex < 0 || correctIndex > 3) correctIndex = 0;
        return {
          id: q.id || uid('q'),
          text: text,
          options: options,
          correctIndex: correctIndex,
          createdAt: q.createdAt || new Date().toISOString(),
        };
      })
      .filter(Boolean);
  }

  function normalizeQuiz(quiz) {
    if (!quiz || typeof quiz !== 'object') return { questions: [] };
    return { questions: normalizeQuizQuestions(quiz.questions) };
  }

  var YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function extractYouTubeVideoIdFromInput(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (YOUTUBE_VIDEO_ID_RE.test(raw)) return raw;

    var patterns = [
      /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
      /youtu\.be\/([A-Za-z0-9_-]{11})/i,
      /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i,
      /m\.youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = raw.match(patterns[i]);
      if (match && match[1] && YOUTUBE_VIDEO_ID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  function normalizeLessonVideoStorage(lesson) {
    var videoId = String((lesson && lesson.videoId) || '').trim();
    var videoUrl = String((lesson && lesson.videoUrl) || '').trim();

    if (!videoId && videoUrl) {
      videoId = extractYouTubeVideoIdFromInput(videoUrl);
    }
    if (videoId && !YOUTUBE_VIDEO_ID_RE.test(videoId)) {
      videoId = '';
    }
    if (videoId) {
      return { videoId: videoId, videoUrl: '' };
    }
    return { videoId: '', videoUrl: videoUrl };
  }

  function normalizeLessons(lessons) {
    if (!Array.isArray(lessons)) return [];
    return lessons
      .map(function (l, index) {
        var videoFields = normalizeLessonVideoStorage(l);
        return {
          id: l.id || uid('lesson'),
          title: String(l.title || '').trim(),
          description: String(l.description || '').trim(),
          videoId: videoFields.videoId,
          videoUrl: videoFields.videoUrl,
          videoFileName: String(l.videoFileName || '').trim(),
          videoTitle: String(l.videoTitle || l.title || '').trim(),
          templateFiles: Array.isArray(l.templateFiles) ? l.templateFiles : [],
          quiz: normalizeQuiz(l.quiz),
          comments: Array.isArray(l.comments) ? l.comments : [],
          views: Number(l.views) || 0,
          completions: Number(l.completions) || 0,
          isFreePreview: !!(l && l.isFreePreview),
          order: typeof l.order === 'number' ? l.order : index + 1,
          createdAt: l.createdAt || new Date().toISOString(),
        };
      })
      .filter(function (l) {
        return !!l.title;
      });
  }

  function usesFirestoreCourses() {
    return !!(
      global.PlatformCoursesFirestore &&
      typeof global.PlatformCoursesFirestore.isReady === 'function' &&
      global.PlatformCoursesFirestore.isReady()
    );
  }

  function isFirestoreCoursesBootstrapping() {
    var FS = global.PlatformCoursesFirestore;
    if (!FS || typeof FS.isReady !== 'function') return false;
    if (FS.isReady()) {
      if (typeof FS.isSeeding === 'function' && FS.isSeeding()) return true;
      return false;
    }
    var cached = typeof FS.getCachedCourses === 'function' ? FS.getCachedCourses() : [];
    if (cached && cached.length) return false;
    return true;
  }

  function readFirestoreCourses() {
    if (!usesFirestoreCourses()) return [];
    return (global.PlatformCoursesFirestore.getCachedCourses() || []).map(normalizeCourse).filter(Boolean);
  }

  function readLocalCoursesCache() {
    ensureSeeded();
    var list = readJson(COURSES_KEY, null);
    if (!list) list = readJson(LEGACY_KEY, []);
    return (Array.isArray(list) ? list : []).map(normalizeCourse).filter(Boolean);
  }

  function normalizeCourse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var rawStatus = String(raw.status || '').toLowerCase();
    var trashFromStatus = rawStatus === 'trash' || rawStatus === 'deleted';
    var email = normalizeEmail(raw.instructorEmail);
    var name = String(raw.instructorName || '').trim();
    var academy = isAcademyAssignment(email, name);
    if (academy) {
      email = ACADEMY_EMAIL;
      name = ACADEMY_NAME;
    }
    return {
      id: raw.id || uid('course'),
      title: String(raw.title || '').trim(),
      description: String(raw.description || '').trim(),
      status: trashFromStatus ? 'draft' : normalizeStatus(raw.status),
      category: normalizeCategory(raw.category),
      instructorEmail: email,
      instructorName: name,
      instructorId: String(raw.instructorId || '').trim(),
      thumbnailUrl: String(raw.thumbnailUrl || raw.thumbnail || '').trim(),
      isAcademy: academy,
      durationHours: Number(raw.durationHours) || 0,
      durationWeeks: Number(raw.durationWeeks) || 0,
      price: parsePrice(raw.price),
      currency: normalizeCurrency(raw.currency),
      requiredPlanId: String(raw.requiredPlanId || raw.planId || '').trim(),
      accessLevel: (function () {
        var level = String(raw.accessLevel || raw.requiredAccessLevel || '').trim().toLowerCase();
        if (level === 'pro') level = 'professional';
        if (level === 'basic') level = 'free';
        if (level === 'free' || level === 'standard' || level === 'professional') return level;
        // Infer from linked plan when available
        if (raw.requiredPlanId && global.PlatformPlans && global.PlatformPlans.findPlan) {
          var linked = global.PlatformPlans.findPlan(raw.requiredPlanId);
          if (linked && linked.accessLevel) return linked.accessLevel;
        }
        // Category-based default access
        var cat = normalizeCategory(raw.category);
        if (cat === 'master') return 'professional';
        if (cat === 'program') return 'standard';
        return 'free';
      })(),
      weeklySchedule: String(raw.weeklySchedule || '').trim(),
      allowedSimulators: (function () {
        if (global.PlatformSimulators && typeof global.PlatformSimulators.normalizeSimulatorIds === 'function') {
          return global.PlatformSimulators.normalizeSimulatorIds(raw.allowedSimulators);
        }
        if (global.PlatformPlans && typeof global.PlatformPlans.normalizeSimulatorIds === 'function') {
          return global.PlatformPlans.normalizeSimulatorIds(raw.allowedSimulators);
        }
        return Array.isArray(raw.allowedSimulators)
          ? raw.allowedSimulators.map(function (id) {
              return String(id || '').trim();
            }).filter(Boolean)
          : [];
      })(),
      autoPricingPlan: !!raw.autoPricingPlan,
      suppressPricingPlan: raw.suppressPricingPlan === true,
      lessons: normalizeLessons(raw.lessons),
      enrolledCount: Number(raw.enrolledCount) || 0,
      views: Number(raw.views) || 0,
      source: raw.source === 'instructor' ? 'instructor' : 'admin',
      softDeleted: trashFromStatus ? true : !!raw.softDeleted,
      previousStatus: raw.previousStatus ? normalizeStatus(raw.previousStatus) : '',
      deletedAt: raw.deletedAt || '',
      sortOrder: (function () {
        if (raw.sortOrder == null || raw.sortOrder === '') return null;
        var n = Number(raw.sortOrder);
        return isFinite(n) ? n : null;
      })(),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    };
  }

  function sortByDisplayOrder(a, b) {
    var ao = a && a.sortOrder != null ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
    var bo = b && b.sortOrder != null ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String((a && a.createdAt) || '').localeCompare(String((b && b.createdAt) || ''));
  }

  /** Assign sortOrder from array index — preserves caller order (used after drag-drop). */
  function assignSortOrderFromArray(list) {
    return (list || []).map(function (course, index) {
      return normalizeCourse(Object.assign({}, course, { sortOrder: index }));
    });
  }

  function withSequentialSortOrder(list) {
    return assignSortOrderFromArray((list || []).slice().sort(sortByDisplayOrder));
  }

  function seedCourses() {
    return withSequentialSortOrder(
      COURSE_PRESETS.map(function (preset) {
        return normalizeCourse(
          Object.assign({}, preset, {
            status: preset.id === 'preset_fiber_basics' || preset.id === 'preset_ftth_basics'
              ? 'published'
              : 'draft',
            createdAt: '2026-06-01T10:00:00.000Z',
            updatedAt: '2026-06-01T10:00:00.000Z',
          })
        );
      })
    );
  }

  function mergeMissingPresets(list) {
    var byId = {};
    var byTitle = {};
    (list || []).forEach(function (c) {
      if (!c) return;
      if (c.id) byId[c.id] = c;
      if (c.title) byTitle[String(c.title).trim()] = c;
    });

    COURSE_PRESETS.forEach(function (preset) {
      if (byId[preset.id] || byTitle[preset.title]) return;
      byId[preset.id] = normalizeCourse(
        Object.assign({}, preset, {
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });

    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function migrateInstructorLocalsIntoCatalog(list) {
    var byId = {};
    list.forEach(function (c) {
      if (c && c.id) byId[c.id] = c;
    });

    var buckets = readJson(INSTRUCTOR_CONTENT_KEY, {});
    if (!buckets || typeof buckets !== 'object') return list;

    Object.keys(buckets).forEach(function (email) {
      var courses = buckets[email] && buckets[email].courses;
      if (!Array.isArray(courses)) return;
      courses.forEach(function (c) {
        if (!c || !c.id) return;
        if (byId[c.id]) {
          var existing = byId[c.id];
          var mergedLessons = normalizeLessons(
            (c.lessons && c.lessons.length ? c.lessons : existing.lessons) || []
          );
          byId[c.id] = normalizeCourse(
            Object.assign({}, existing, {
              lessons: mergedLessons,
              enrolledCount: c.enrolledCount != null ? c.enrolledCount : existing.enrolledCount,
              views: c.views != null ? c.views : existing.views,
              instructorEmail: existing.instructorEmail || email,
              instructorName: existing.instructorName || '',
            })
          );
          return;
        }
        if (c.platformManaged) return;
        byId[c.id] = normalizeCourse(
          Object.assign({}, c, {
            instructorEmail: normalizeEmail(c.instructorEmail || email),
            status: c.status || 'draft',
            source: 'instructor',
          })
        );
      });
    });

    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function ensureSeeded() {
    var version = storageGet(SEED_VERSION_KEY);
    var current = readJson(COURSES_KEY, null);
    var legacy = readJson(LEGACY_KEY, null);

    if (version !== SEED_VERSION || !Array.isArray(current)) {
      var base = [];
      if (Array.isArray(current) && current.length) base = current;
      else if (Array.isArray(legacy) && legacy.length) base = legacy;
      else base = seedCourses();

      base = base.map(normalizeCourse).filter(Boolean);
      base = migrateInstructorLocalsIntoCatalog(base);
      base = mergeMissingPresets(base);
      base = withSequentialSortOrder(base);
      writeJson(COURSES_KEY, base);
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      writeJson(LEGACY_KEY, base);
      return;
    }

    if (!Array.isArray(current)) writeJson(COURSES_KEY, []);
  }

  function ensureDisplayOrder(list) {
    var needs = !(list || []).length
      ? false
      : list.some(function (c) {
          return c.sortOrder == null || !isFinite(Number(c.sortOrder));
        });
    if (!needs) return (list || []).slice().sort(sortByDisplayOrder);
    var ordered = withSequentialSortOrder(list);
    if (!usesFirestoreCourses()) {
      emitChanged(ordered, { type: 'ensure-order' });
    }
    return ordered;
  }

  function emitChanged(list, detail) {
    writeJson(COURSES_KEY, list);
    writeJson(LEGACY_KEY, list);
    var payload = Object.assign({ count: list.length, key: COURSES_KEY }, detail || {});
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-courses-changed', { detail: payload }));
    } catch (err) {
      /* ignore */
    }
  }

  function getCourses() {
    if (isFirestoreCoursesBootstrapping()) {
      return ensureDisplayOrder(readLocalCoursesCache());
    }
    if (usesFirestoreCourses()) {
      return ensureDisplayOrder(readFirestoreCourses());
    }
    return ensureDisplayOrder(readLocalCoursesCache());
  }

  function saveCourses(list, detail) {
    if (usesFirestoreCourses()) {
      console.warn(
        '[PlatformCourses] saveCourses ignored while Firestore sync is active — use PlatformCoursesFirestore CRUD'
      );
      return assignSortOrderFromArray(list || []);
    }
    /* Preserve array order — source of truth after drag-reorder. */
    var normalized = assignSortOrderFromArray(list || []);
    emitChanged(normalized, detail);
    return normalized;
  }

  function findCourse(id) {
    var key = String(id || '');
    if (!key) return null;
    if (isFirestoreCoursesBootstrapping()) {
      var localList = readLocalCoursesCache();
      for (var li = 0; li < localList.length; li++) {
        if (localList[li].id === key) return localList[li];
      }
      return null;
    }
    if (usesFirestoreCourses() && global.PlatformCoursesFirestore.findCourse) {
      var cached = global.PlatformCoursesFirestore.findCourse(key);
      return cached ? normalizeCourse(cached) : null;
    }
    var list = getCourses();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === key) return list[i];
    }
    return null;
  }

  function getPublished() {
    var source;
    if (isFirestoreCoursesBootstrapping()) {
      source = readLocalCoursesCache();
    } else if (usesFirestoreCourses()) {
      source = readFirestoreCourses();
    } else {
      source = readLocalCoursesCache();
    }
    return source
      .filter(function (c) {
        return c.status === 'published' && !c.softDeleted;
      })
      .slice()
      .sort(sortByDisplayOrder);
  }

  /**
   * Reorder by visible id sequence. Non-listed courses keep their slots.
   * Rewrites sortOrder from the final array index into platform_courses.
   */
  function reorderCourses(orderedIds) {
    if (usesFirestoreCourses() && global.PlatformCoursesFirestore.reorderCourses) {
      return global.PlatformCoursesFirestore.reorderCourses(orderedIds);
    }
    var all = getCourses().slice().sort(sortByDisplayOrder);
    var byId = {};
    all.forEach(function (c) {
      byId[c.id] = c;
    });

    var subset = [];
    var subsetSet = {};
    (orderedIds || []).forEach(function (id) {
      var key = String(id || '');
      if (!key || !byId[key] || subsetSet[key]) return;
      subset.push(byId[key]);
      subsetSet[key] = true;
    });
    if (!subset.length) return all;

    var cursor = 0;
    var merged = all.map(function (course) {
      if (!subsetSet[course.id]) return course;
      return subset[cursor++];
    });

    if (cursor !== subset.length) {
      merged = subset.slice();
      all.forEach(function (course) {
        if (!subsetSet[course.id]) merged.push(course);
      });
    }

    return saveCourses(merged, { type: 'reorder', orderedIds: orderedIds });
  }

  function getDrafts() {
    return getCourses().filter(function (c) {
      return c.status === 'draft' || c.softDeleted;
    });
  }

  function getActiveCourses() {
    return getCourses().filter(function (c) {
      return !c.softDeleted && c.status !== 'draft';
    });
  }

  function getByInstructor(email) {
    var key = normalizeEmail(email);
    if (!key) return [];
    return getCourses().filter(function (c) {
      return !c.softDeleted && normalizeEmail(c.instructorEmail) === key;
    });
  }

  function formatDuration(course) {
    if (!course) return '—';
    var parts = [];
    if (course.durationWeeks) parts.push(course.durationWeeks + ' أسبوع');
    if (course.durationHours) parts.push(course.durationHours + ' ساعة');
    if (!parts.length && course.weeklySchedule) return course.weeklySchedule;
    return parts.length ? parts.join(' · ') : '—';
  }

  function formatPrice(course) {
    if (!course) return '—';
    var amount = parsePrice(course.price);
    if (!amount) return 'مجاناً';
    return formatGroupedAmount(amount) + ' ' + currencyLabel(course.currency);
  }

  function resolveCoursePlan(course) {
    if (!course) return null;
    if (!global.PlatformPlans) return null;
    if (course.requiredPlanId && typeof global.PlatformPlans.findPlan === 'function') {
      var byId = global.PlatformPlans.findPlan(course.requiredPlanId);
      if (byId) return byId;
    }
    if (course.accessLevel && typeof global.PlatformPlans.findPlanByAccessLevel === 'function') {
      return global.PlatformPlans.findPlanByAccessLevel(course.accessLevel);
    }
    return null;
  }

  function formatCourseAccessLabel(course) {
    var plan = resolveCoursePlan(course);
    if (plan && plan.name) return plan.name;
    var level = course && course.accessLevel;
    if (level === 'professional') return 'احترافي';
    if (level === 'standard') return 'قياسي';
    if (level === 'free') return 'مجاني';
    return '—';
  }

  function resolveInstructorName(email, fallback) {
    if (isAcademyAssignment(email, fallback)) return ACADEMY_NAME;
    var key = normalizeEmail(email);
    if (fallback) return String(fallback).trim();
    if (!key) return ACADEMY_NAME;
    if (global.InstructorApps && typeof global.InstructorApps.findActiveInstructor === 'function') {
      var inst = global.InstructorApps.findActiveInstructor(key);
      if (inst && inst.fullName) return inst.fullName;
    }
    return key;
  }

  function findPreset(presetId) {
    for (var i = 0; i < COURSE_PRESETS.length; i++) {
      if (COURSE_PRESETS[i].id === presetId) return COURSE_PRESETS[i];
    }
    return null;
  }

  function getPresetsGrouped() {
    return {
      individual: COURSE_PRESETS.filter(function (p) {
        return p.category === 'individual';
      }),
      program: COURSE_PRESETS.filter(function (p) {
        return p.category === 'program';
      }),
      master: COURSE_PRESETS.filter(function (p) {
        return p.category === 'master';
      }),
      all: COURSE_PRESETS.slice(),
    };
  }

  function addCourse(payload) {
    if (usesFirestoreCourses()) {
      console.warn(
        '[PlatformCourses] addCourse ignored while Firestore sync is active — use PlatformCoursesFirestore.addCourse'
      );
      return null;
    }
    var list = getCourses();
    var instructorEmail = normalizeEmail(payload && payload.instructorEmail);
    var instructorName = resolveInstructorName(instructorEmail, payload && payload.instructorName);
    var course = normalizeCourse({
      id: uid('course'),
      title: payload && payload.title,
      description: payload && payload.description,
      status: (payload && payload.status) || 'draft',
      category: payload && payload.category,
      instructorEmail: instructorEmail,
      instructorName: instructorName,
      durationHours: payload && payload.durationHours,
      durationWeeks: payload && payload.durationWeeks,
      price: payload && payload.price,
      currency: payload && payload.currency,
      requiredPlanId: payload && payload.requiredPlanId,
      accessLevel: payload && payload.accessLevel,
      allowedSimulators: payload && payload.allowedSimulators,
      autoPricingPlan: payload && payload.autoPricingPlan,
      weeklySchedule: payload && payload.weeklySchedule,
      lessons: payload && payload.lessons,
      enrolledCount: payload && payload.enrolledCount,
      views: payload && payload.views,
      source: (payload && payload.source) || 'admin',
      softDeleted: false,
      sortOrder: -1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!course.title) throw new Error('عنوان الكورس مطلوب');
    list.unshift(course);
    saveCourses(list, { type: 'add', id: course.id });
    return course;
  }

  function updateCourse(id, patch) {
    if (usesFirestoreCourses()) {
      console.warn(
        '[PlatformCourses] updateCourse ignored while Firestore sync is active — use PlatformCoursesFirestore.updateCourse'
      );
      return findCourse(id);
    }
    var list = getCourses();
    var found = null;
    list = list.map(function (c) {
      if (c.id !== id) return c;
      var nextEmail =
        patch && patch.instructorEmail != null
          ? normalizeEmail(patch.instructorEmail)
          : c.instructorEmail;
      found = normalizeCourse(
        Object.assign({}, c, patch || {}, {
          id: c.id,
          instructorEmail: nextEmail,
          instructorName: resolveInstructorName(
            nextEmail,
            patch && patch.instructorName != null ? patch.instructorName : c.instructorName
          ),
          status: patch && patch.status != null ? patch.status : c.status,
          lessons: patch && patch.lessons != null ? patch.lessons : c.lessons,
          softDeleted: patch && patch.softDeleted != null ? !!patch.softDeleted : c.softDeleted,
          updatedAt: new Date().toISOString(),
          createdAt: c.createdAt,
        })
      );
      if (!found.title) throw new Error('عنوان الكورس مطلوب');
      return found;
    });
    if (!found) throw new Error('الكورس غير موجود');
    saveCourses(list, { type: 'update', id: id });
    return found;
  }

  function setCourseStatus(id, status) {
    var next = normalizeStatus(status);
    return updateCourse(id, {
      status: next,
      softDeleted: false,
      deletedAt: '',
      previousStatus: '',
    });
  }

  /** Soft-delete: move course into Drafts (مسودة) instead of permanent removal. */
  function softDeleteCourse(id) {
    var course = findCourse(id);
    if (!course) throw new Error('الكورس غير موجود');
    return updateCourse(id, {
      previousStatus: course.status === 'draft' ? course.previousStatus || 'published' : course.status,
      status: 'draft',
      softDeleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  /** Restore a soft-deleted / draft course back to its previous active status. */
  function restoreCourse(id) {
    var course = findCourse(id);
    if (!course) throw new Error('الكورس غير موجود');
    var nextStatus = course.previousStatus || 'published';
    if (nextStatus === 'draft') nextStatus = 'published';
    return updateCourse(id, {
      status: nextStatus,
      softDeleted: false,
      deletedAt: '',
      previousStatus: '',
    });
  }

  /** Permanent delete from platform_courses. */
  function deleteCourse(id) {
    var list = getCourses();
    var removed = null;
    var next = [];
    list.forEach(function (c) {
      if (c.id === id) removed = c;
      else next.push(c);
    });
    if (!removed) throw new Error('الكورس غير موجود');
    saveCourses(next, { type: 'delete', id: id });
    return removed;
  }

  function getPublishedCount() {
    return getPublished().length;
  }

  function getDraftCount() {
    return getDrafts().length;
  }

  function toInstructorShape(course) {
    var c = normalizeCourse(course);
    return Object.assign({}, c, {
      platformManaged: c.source === 'admin' || c.isAcademy,
      instructorEmail: c.instructorEmail,
    });
  }

  ensureSeeded();

  global.PlatformCourses = {
    COURSES_KEY: COURSES_KEY,
    ACADEMY_NAME: ACADEMY_NAME,
    ACADEMY_EMAIL: ACADEMY_EMAIL,
    uid: uid,
    defaultSeedCourses: seedCourses,
    usesFirestore: usesFirestoreCourses,
    isFirestoreBootstrapping: isFirestoreCoursesBootstrapping,
    COURSE_PRESETS: COURSE_PRESETS,
    getPresetsGrouped: getPresetsGrouped,
    findPreset: findPreset,
    getCourses: getCourses,
    getPublished: getPublished,
    getDrafts: getDrafts,
    getActiveCourses: getActiveCourses,
    getByInstructor: getByInstructor,
    findCourse: findCourse,
    addCourse: addCourse,
    updateCourse: updateCourse,
    setCourseStatus: setCourseStatus,
    softDeleteCourse: softDeleteCourse,
    restoreCourse: restoreCourse,
    deleteCourse: deleteCourse,
    reorderCourses: reorderCourses,
    sortByDisplayOrder: sortByDisplayOrder,
    formatDuration: formatDuration,
    formatPrice: formatPrice,
    parsePrice: parsePrice,
    formatGroupedAmount: formatGroupedAmount,
    normalizeCurrency: normalizeCurrency,
    currencyLabel: currencyLabel,
    resolveCoursePlan: resolveCoursePlan,
    formatCourseAccessLabel: formatCourseAccessLabel,
    getPublishedCount: getPublishedCount,
    getDraftCount: getDraftCount,
    toInstructorShape: toInstructorShape,
    normalizeCourse: normalizeCourse,
    isAcademyAssignment: isAcademyAssignment,
  };
})(typeof window !== 'undefined' ? window : this);
