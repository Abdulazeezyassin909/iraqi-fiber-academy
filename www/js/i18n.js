/**
 * Platform i18n — Arabic / English via data-i18n attributes and PlatformI18n.t().
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'ifa_lang';

  var dict = {
    ar: {
      'nav.home': 'الرئيسية',
      'nav.courses': 'الكورسات التعليمية',
      'nav.simulators': 'المحاكيات',
      'nav.plans': 'الباقات',
      'nav.articles': 'المقالات التقنية',
      'nav.faq': 'الأسئلة الشائعة',
      'header.login': 'تسجيل الدخول',
      'header.cta': 'ابدأ مجاناً',
      'header.navToggle': 'فتح القائمة',
      'header.navClose': 'إغلاق القائمة',
      'settings.menu': 'الإعدادات',
      'settings.notifications': 'الإشعارات',
      'settings.pushNotifications': 'إشعارات المتصفح',
      'settings.pushDeniedHint':
        'لتفعيل الإشعارات، افتح إعدادات الموقع في المتصفح واسمح بالإشعارات.',
      'settings.theme': 'المظهر',
      'settings.language': 'اللغة',
      'settings.markAllRead': 'تعيين الكل كمقروء',
      'settings.emptyNotifications': 'لا توجد إشعارات حالياً',
      'settings.viewDetails': 'عرض التفاصيل',
      'logo.main': 'مسار المهندس ‎°360',
      'logo.sub': 'منصة المسار المهني الهندسي',
      'hero.default.title': 'مسارك المهني الهندسي يبدأ هنا',
      'hero.default.description': 'منصة المسار المهني الهندسي — كورسات منظمة ومحاكيات تفاعلية لبناء مهاراتك خطوة بخطوة.',
      'hero.default.cta': 'ابدأ التدريب الآن',
      'hero.default.secondaryCta': 'Try Simulator',
      'hero.default.badge': 'منصة المسار المهني الهندسي',
      'hero.trust.realistic': 'محاكاة واقعية 100%',
      'hero.trust.certificates': 'شهادات معتمدة',
      'hero.trust.support': 'دعم فني متواصل',
      'stats.enrolled': 'طالب مسجّل',
      'stats.kilometers': 'كيلومتر محاكى',
      'stats.projects': 'مشروع تدريبي',
      'stats.satisfaction': '% رضا الطلاب',
      'section.simulators.badge': 'بيئة التدريب العملي',
      'section.simulators.title': 'المحاكيات',
      'section.simulators.subtitle': 'أدوات محاكاة متقدمة مصممة خصيصاً لفنيي ومهندسي الألياف الضوئية',
      'section.courses.badge': 'رحلتك التعليمية',
      'section.courses.title': 'المسار من الصفر للاحتراف',
      'section.courses.subtitle': 'كورسات منظمة تأخذك من المفاهيم الأساسية إلى إدارة مشاريع FTTH كاملة',
      'section.demo.badge': 'معاينة المحاكيات',
      'section.demo.title': 'محاكي FTTH متكامل',
      'section.demo.subtitle':
        'صمّم واربط شبكات الألياف الضوئية من OLT حتى منزل المشترك مع محاكاة واقعية لكل مكوّن في الشبكة.',
      'section.demo.cta': 'Try Simulator',
      'section.demo.soon': 'قريباً — قيد التطوير',
      'section.articles.badge': 'معرفة تقنية',
      'section.articles.title': 'المقالات التقنية',
      'section.articles.subtitle': 'أدلة عملية ومحتوى من المدربين لمساعدتك على إتقان شبكات FTTH والألياف الضوئية',
      'section.pricing.badge': 'خطط الاشتراك',
      'section.pricing.title': 'اختر الباقة المناسبة لك',
      'section.pricing.subtitle': 'ابدأ مجاناً وطوّر مهاراتك مع باقات تناسب كل المستويات',
      'section.testimonials.badge': 'آراء المستخدمين',
      'section.testimonials.title': 'ماذا يقول طلابنا؟',
      'section.testimonials.subtitle': 'تجارب حقيقية من فنيين ومهندسين استفادوا من منصتنا',
      'section.faq.badge': 'أسئلة شائعة',
      'section.faq.title': 'كل ما تحتاج معرفته',
      'section.faq.subtitle': 'إجابات على أكثر الأسئلة تكراراً حول المنصة والمحاكي والاشتراكات',
      'footer.desc': 'منصة المسار المهني الهندسي — مسارات تعليمية ومحاكاة عملية لمهندسي وفنيي الاتصالات والبنية التحتية.',
      'footer.social': 'روابط التواصل',
      'footer.platform': 'المنصة',
      'footer.features': 'المميزات',
      'footer.learningPath': 'المسار التعليمي',
      'footer.simulator': 'المحاكي',
      'footer.support': 'الدعم',
      'footer.helpCenter': 'مركز المساعدة',
      'footer.contact': 'تواصل معنا',
      'footer.dashboards': 'لوحات التحكم',
      'footer.joinInstructor': 'انضم إلينا كمدرب',
      'footer.copyright': '© 2026 مسار المهندس ‎°360. جميع الحقوق محفوظة لمسار المهندس ‎°360.',
      'footer.privacy': 'سياسة الخصوصية',
      'footer.terms': 'شروط الاستخدام',
      'auth.login': 'تسجيل الدخول',
      'auth.signup': 'إنشاء حساب',
      'auth.logout': 'تسجيل خروج',
      'auth.logoutSim': 'تسجيل الخروج',
      'auth.switchLogin': 'لديك حساب؟ تسجيل الدخول',
      'auth.switchSignup': 'ليس لديك حساب؟ إنشاء حساب',
      'auth.close': 'إغلاق',
      'checkout.loading': 'جاري تحميل صفحة الدفع…',
      'checkout.successTitle': 'تم استلام طلبك',
      'checkout.successMessage':
        'تم استلام طلبك بنجاح، وسيتم تفعيل الكورس فور مراجعة الوصل من الإدارة.',
      'checkout.ok': 'حسناً',
      'instructor.modalTitle': 'انضم إلينا كمدرب',
      'instructor.modalSubtitle':
        'قدّم طلبك للانضمام إلى فريق المدربين في مسار المهندس ‎°360. ستتم مراجعة الطلب من لوحة الإدارة.',
      'page.title.home': 'مسار المهندس ‎°360 | Engineer Path °360',
      'page.title.courseDetails': 'تفاصيل الكورس | مسار المهندس ‎°360',
      'page.title.checkout': 'إتمام الدفع | مسار المهندس ‎°360',
      'page.title.admin': 'لوحة الإدارة | ENGINEER PATH °360 Admin',
      'time.now': 'الآن',
      'time.minutes': ' د',
      'time.hours': ' س',
    },
    en: {
      'nav.home': 'Home',
      'nav.courses': 'Courses',
      'nav.simulators': 'Simulators',
      'nav.plans': 'Plans',
      'nav.articles': 'Articles',
      'nav.faq': 'FAQ',
      'header.login': 'Login',
      'header.cta': 'Start Free',
      'header.navToggle': 'Open menu',
      'header.navClose': 'Close menu',
      'settings.menu': 'Settings',
      'settings.notifications': 'Notifications',
      'settings.pushNotifications': 'Browser notifications',
      'settings.pushDeniedHint':
        'To enable notifications, open your browser site settings and allow notifications for this site.',
      'settings.theme': 'Theme',
      'settings.language': 'Language',
      'settings.markAllRead': 'Mark all read',
      'settings.emptyNotifications': 'No notifications yet',
      'settings.viewDetails': 'View details',
      'logo.main': 'Engineer Path °360',
      'logo.sub': 'Engineering Career Path Platform',
      'hero.default.title': 'Your Engineering Career Path Starts Here',
      'hero.default.description':
        'Engineering Career Path Platform — structured courses and interactive simulators to build your skills step by step.',
      'hero.default.cta': 'Start Training Now',
      'hero.default.secondaryCta': 'Try Simulator',
      'hero.default.badge': 'Engineering Career Path Platform',
      'hero.trust.realistic': '100% Realistic Simulation',
      'hero.trust.certificates': 'Certified Courses',
      'hero.trust.support': 'Ongoing Technical Support',
      'stats.enrolled': 'Enrolled Students',
      'stats.kilometers': 'Simulated Kilometers',
      'stats.projects': 'Training Projects',
      'stats.satisfaction': 'Student Satisfaction %',
      'section.simulators.badge': 'Hands-On Training',
      'section.simulators.title': 'Simulators',
      'section.simulators.subtitle': 'Advanced simulation tools built for fiber technicians and engineers',
      'section.courses.badge': 'Your Learning Journey',
      'section.courses.title': 'From Zero to Professional',
      'section.courses.subtitle': 'Structured courses from fundamentals to full FTTH project management',
      'section.demo.badge': 'Simulator Preview',
      'section.demo.title': 'Full FTTH Simulator',
      'section.demo.subtitle':
        'Design and connect fiber networks from OLT to the subscriber home with realistic simulation of every network component.',
      'section.demo.cta': 'Try Simulator',
      'section.demo.soon': 'Coming Soon — In Development',
      'section.articles.badge': 'Technical Knowledge',
      'section.articles.title': 'Technical Articles',
      'section.articles.subtitle': 'Practical guides from instructors to master FTTH and fiber optics',
      'section.pricing.badge': 'Subscription Plans',
      'section.pricing.title': 'Choose the Right Plan',
      'section.pricing.subtitle': 'Start free and grow your skills with plans for every level',
      'section.testimonials.badge': 'User Reviews',
      'section.testimonials.title': 'What Our Students Say',
      'section.testimonials.subtitle': 'Real experiences from technicians and engineers who benefited from our platform',
      'section.faq.badge': 'FAQ',
      'section.faq.title': 'Everything You Need to Know',
      'section.faq.subtitle': 'Answers to the most common questions about the platform, simulator, and subscriptions',
      'footer.desc':
        'Engineering Career Path Platform — learning paths and hands-on simulation for telecom and infrastructure engineers.',
      'footer.social': 'Social links',
      'footer.platform': 'Platform',
      'footer.features': 'Features',
      'footer.learningPath': 'Learning Path',
      'footer.simulator': 'Simulator',
      'footer.support': 'Support',
      'footer.helpCenter': 'Help Center',
      'footer.contact': 'Contact Us',
      'footer.dashboards': 'Dashboards',
      'footer.joinInstructor': 'Join as Instructor',
      'footer.copyright': '© 2026 Engineer Path °360. All rights reserved.',
      'footer.privacy': 'Privacy Policy',
      'footer.terms': 'Terms of Use',
      'auth.login': 'Login',
      'auth.signup': 'Sign Up',
      'auth.logout': 'Log Out',
      'auth.logoutSim': 'Log Out',
      'auth.switchLogin': 'Already have an account? Log in',
      'auth.switchSignup': "Don't have an account? Sign up",
      'auth.close': 'Close',
      'checkout.loading': 'Loading checkout…',
      'checkout.successTitle': 'Order Received',
      'checkout.successMessage':
        'Your order was received successfully. The course will be activated once payment is reviewed by admin.',
      'checkout.ok': 'OK',
      'instructor.modalTitle': 'Join as Instructor',
      'instructor.modalSubtitle':
        'Apply to join the instructor team at Engineer Path °360. Your application will be reviewed by admin.',
      'page.title.home': 'Engineer Path °360 | Engineering Career Path Platform',
      'page.title.courseDetails': 'Course Details | Engineer Path °360',
      'page.title.checkout': 'Checkout | Engineer Path °360',
      'page.title.admin': 'Admin | ENGINEER PATH °360 Admin',
      'time.now': 'Now',
      'time.minutes': 'm',
      'time.hours': 'h',
    },
  };

  function getLang() {
    try {
      if (global.PlatformSettings && typeof global.PlatformSettings.getLang === 'function') {
        return global.PlatformSettings.getLang();
      }
      return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar';
    } catch (err) {
      return 'ar';
    }
  }

  function t(key, lang) {
    var code = lang || getLang();
    var bucket = dict[code] || dict.ar;
    if (bucket[key] != null) return bucket[key];
    if (code !== 'ar' && dict.ar[key] != null) return dict.ar[key];
    return key;
  }

  function applyDocumentTitle(lang) {
    var code = lang || getLang();
    var el = document.querySelector('[data-i18n-document-title]');
    if (!el) return;
    var key = el.getAttribute('data-i18n-document-title');
    if (key) document.title = t(key, code);
  }

  function applyTo(root, lang) {
    var scope = root && root.querySelectorAll ? root : document;
    var code = lang || getLang();

    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key, code);
    });

    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key, code));
    });

    scope.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key, code));
    });

    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key, code));
    });

    if (!root || root === document) applyDocumentTitle(code);

    if (global.PlatformFooter && typeof global.PlatformFooter.applyLogoSubtitle === 'function') {
      global.PlatformFooter.applyLogoSubtitle(scope);
    }
  }

  function apply(lang) {
    var code = lang === 'en' ? 'en' : 'ar';
    applyTo(document, code);
  }

  function boot() {
    apply(getLang());
  }

  try {
    var stored = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar';
    document.documentElement.lang = stored === 'en' ? 'en' : 'ar';
    document.documentElement.dir = stored === 'en' ? 'ltr' : 'rtl';
  } catch (err) {
    /* ignore */
  }

  global.addEventListener('ifa:settings-lang-changed', function (e) {
    var lang = e && e.detail && e.detail.lang ? e.detail.lang : getLang();
    apply(lang);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.PlatformI18n = {
    LANG_KEY: LANG_KEY,
    dict: dict,
    getLang: getLang,
    t: t,
    apply: apply,
    applyTo: applyTo,
  };
})(typeof window !== 'undefined' ? window : this);
