# 6B — ממשק המשחק

עודכן: 19.09.2026. React **18.2** לפי package.json, TypeScript, Vite **8**, Tailwind CSS 4, CSS Modules ו־Motion. תיאורי React 19/Vite 5 במסמכים ישנים אינם תואמים לתלויות המוצהרות.

## הרצה

~~~sh
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
~~~

dev משתמש בפורט 5173 וב־base=/backgammon/. /backgammon/api ו־/backgammon/ws מועברים לשרת המשחק ב־8000. test משתמש ב־Playwright Component Testing, לפי playwright-ct.config.ts; אין כאן טענת הצלחה של בדיקות חדשות.

## נתיבים ומצב

| נתיב בתוך /backgammon | התנהגות |
|---|---|
| /, /home | הפניה למועדון לפי VITE_TOURNAMENTS_URL, ברירת מחדל /tournaments/ |
| /link | כניסה עם הרשאה מכרטיס; מחוץ ל־RequireAuth כדי לאפשר הקמת session |
| /waiting/:roomId | חדר המתנה, דורש הרשאה |
| /game/:roomId | GameProvider, WebSocket ומשחק סמכותי בשרת |
| /local | LocalGameProvider, מנוע ובוט TypeScript |
| /history, /history/:id | היסטוריית שרת המשחק, דורשת הרשאה |

src/router.tsx הוא מקור האמת. query של /local תומך ב־bot, target, time ו־mode; יעד ברירת המחדל הוא 7. מנגנון החזרה מהמשחק בודק שכתובת return שייכת למועדון המוגדר. gameType בנתיב אינו מחליף את פורמט המשחק שנאכף בשרת.

GameProvider נמצא ב־src/services/gameContext.tsx; LocalGameProvider ב־localGameContext.tsx. חוקי התצוגה/המשחק המקומי נמצאים ב־src/lib/backgammon; הבוט המקומי ב־src/lib/bot. מצב מקוון נשלח ככוונות פעולה, ולא כלוח שרירותי מהלקוח.

## רכיבים ועיצוב

GameScreen מחבר Board, קוביות, שעונים, פעולות, תוצאה והגדרות. MatchHistory/MatchDetail מציגים היסטוריה של שרת המשחק; מסך הניתוח המלא נמצא באתר Vue של המועדון. HomeScreen/AuthScreen קיימים בקוד אך אינם מסכי השורש הפעילים.

src/styles/global.css מגדיר טוקנים, Assistant גם לגוף וגם לכותרות, בסיס כהה וגובה מסך. CSS Modules מגדירים את הרכיבים; אין להניח שכל העיצוב עבר ל־Tailwind. [הנחיות עיצוב](UI_GUIDELINES.md), [עיצוב המערכת](../../docs/UI_DESIGN.he.md).

## שירותים נלווים

משחק מקומי אינו מסלול Open Sage. [תרגול שרת](../../docs/open-sage-practice.he.md). ל־PWA זהות /backgammon/, scope=/ ופתיחה ב־/tournaments/. [התקנה](PWA_DEPLOYMENT.he.md). את סודות השירותים שומרים בשרת; משתני VITE נחשפים בדפדפן.
