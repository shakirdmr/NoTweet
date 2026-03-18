# البنية التقنية — NoTweet

## نظرة عامة

الإضافة مكوّنة من ثلاثة أجزاء رئيسية تعمل معاً:

```
┌─────────────────────────────────────────────────────┐
│                    صفحة تويتر/X                      │
│                                                     │
│  ┌──────────────────┐     ┌────────────────────┐    │
│  │  Content Script  │────▶│   Side Panel (UI)  │    │
│  │  (content.js)    │     │   (React + Shadow) │    │
│  └────────┬─────────┘     └────────────────────┘    │
│           │ رسائل chrome.runtime                     │
│  ┌────────▼─────────┐                               │
│  │  Service Worker  │ ◀── Claude API                 │
│  │  (background.js) │                               │
│  └──────────────────┘                               │
└─────────────────────────────────────────────────────┘
```

---

## الجزء الأول: Content Script

**الملف:** `src/content/content.js` + `src/content/typer.js` + `src/content/observer.js`

هذا الجزء يعمل داخل صفحة تويتر مباشرة.

### ماذا يفعل؟

1. **يراقب التغريدات** — يستخدم `MutationObserver` ليلاحظ عندما تظهر تغريدات جديدة في الصفحة
2. **يختار التغريدة** — يفلتر التغريدات بناءً على الكلمات والحسابات المطلوبة
3. **يطلب الرد** — يرسل نص التغريدة إلى Service Worker ليطلب من Claude رداً
4. **يكتب الرد** — يفتح صندوق الرد ويكتب الكلمات حرفاً بحرف لتبدو طبيعية
5. **يرسل الرد** — ينقر زر الإرسال

### حلقة الردود

```
startReplyLoop()
    ↓
scheduleNextReply()  ← ينتظر X دقيقة
    ↓
runReplyLoop()
    ↓
هل هناك تغريدة جديدة؟
    ↓ نعم
typeReply() ← يكتب ويرسل
    ↓
scheduleNextReply() ← ينتظر مرة أخرى
```

---

## الجزء الثاني: Service Worker (الخلفية)

**الملف:** `src/background/background.js` + `src/background/prompts.js`

يعمل في الخلفية حتى لو أُغلقت الصفحة لفترة قصيرة.

### ماذا يفعل؟

- **يستدعي Claude API** — يرسل نص التغريدة ويستقبل الرد المقترح
- **يحفظ البيانات** — يخزن الإحصائيات، التغريدات المرئية، والإعدادات في `chrome.storage.local`
- **يوزّع الرسائل** — يستقبل طلبات من Content Script والواجهة ويردّ عليها

### التخزين

```
chrome.storage.local
│
├── settings    ← إعدادات المستخدم (API key, حدود, تأخير...)
├── state       ← حالة البوت (عداد الردود, التغريدات المرئية...)
├── log         ← سجل آخر 100 عملية
└── replybackQueue ← طابور الردود على ردود المستخدم
```

---

## الجزء الثالث: الواجهة (UI)

**الملفات:** `src/ui/`

واجهة React تعمل داخل **Shadow DOM** حتى لا تتعارض أنماطها مع أنماط تويتر.

### الشاشات

- **Status** — يعرض الإحصائيات، الحالة، وأزرار التشغيل
- **Settings** — يعدّل إعدادات البوت
- **Log** — يعرض آخر الأنشطة
- **Correct** — يساعد في تصحيح التغريدات يدوياً

---

## تدفق الرسائل

```
Content Script  ──GENERATE_REPLY──▶  Background  ──▶  Claude API
Content Script  ◀──────reply text──  Background  ◀──  Claude

Content Script  ──LOG_OUTBOUND────▶  Background  (يحفّظ في storage)
Background      ──STATUS_UPDATE───▶  UI Panel    (يحدّث الأرقام)
```

---

## ملفات مهمة

| الملف | الوظيفة |
|-------|---------|
| `src/content/content.js` | حلقة الردود الرئيسية |
| `src/content/typer.js` | محاكاة الكتابة البشرية |
| `src/content/observer.js` | مراقبة التغريدات في DOM |
| `src/background/background.js` | منطق الخلفية والتخزين |
| `src/background/prompts.js` | برومبتات Claude |
| `src/shared/constants.js` | ثوابت مشتركة بين الأجزاء |
| `src/ui/components/SidePanel.jsx` | الواجهة الرئيسية |
