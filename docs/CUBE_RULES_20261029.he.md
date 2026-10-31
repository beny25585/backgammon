# תיקון חוקי הכפלה והטלה מול בית סגור

29.10.2026 — המשתמש אישר להתחיל בתיקונים שהוכחו בקוד: קובייה מתה בסדרה והמשך התור לאחר קבלת הכפלה. בהמשך ביקש לחסוך לחיצה כשיש אבן על הבר מול בית סגור לגמרי, והבהיר שההתנהגות הרצויה היא הודעה והעברת תור **ללא הטלה**, גם כשעדיין קיימת אפשרות חוקית להכפיל. הבהרה זו מחליפה את מימוש ההטלה האוטומטית מהסבב הקודם. המימוש מקומי; אין Git או פריסה במסגרת עבודה זו.

## ההתנהגות

- בסדרה, מציע שהקובייה הנוכחית כבר מספיקה לו לניצחון רגיל אינו רשאי להכפיל. התנאי הוא `cube >= targetPoints - score[offerer]`. בסדרה ל־3 בניקוד 0–0 מותר להגיע מ־2 ל־4, ואסור להמשיך מ־4 ל־8. בניקוד שונה ההגבלה אישית למציע. משחקי `money` ממשיכים להשתמש בתקרה שלהם.
- השרת לוקח יעד וניקוד מהחדר. הלקוח משתמש באותו כלל לזמינות כפתור ההכפלה ולפעולות הישירות במשחק מקוון ומקומי. ללא הקשר סדרה ידוע, קריאות מנוע עצמאיות שומרות על התנהגות התקרה הקיימת. נשמרים Crawford, בעלות ותור; לא מוצעת הכפלה שערכה הבא עובר את התקרה.
- גם החלטת ההכפלה של Open Sage משתמשת באותו תנאי שרת. כאשר הקובייה מתה, הבוט מתקדם להטלה בלי לבקש החלטת הכפלה שאחר כך תידחה.
- קבלת הכפלה מחזירה את המציע ל־`rolling`, מעבירה בעלות למקבל ומנקה `dice`, `remaining`, `lastMove` ו־`moveHistory`. המציע טרם הטיל בתור הזה: אחרי הקבלה מגיעה **ההטלה הראשונה**, לא הטלה נוספת. קוביות מהתור החסום הקודם אינן מאפשרות לסיים את התור החדש. צילום החסימה נשמר בנפרד במסלול ההודעה הקיים.
- כשיש אבן על הבר וכל שש נקודות הכניסה מאוישות בלפחות שתי אבני יריב, הבקשה הקיימת פותרת את התור **בלי לפנות לשירות הקוביות**. מוצגת הודעת חסימה מיידית ללא קוביות, והתור עובר ליריב. ההתנהגות חלה גם כשהעדפת Auto Roll כבויה ואינה משנה אותה. חמש נקודות סגורות בלבד או אבן יריב בודדת אינן מפעילות דילוג מוקדם; הטלה אמיתית שחסומה רק לפי הערכים שלה עדיין נשמרת ומוצגת.
- השרת מאמת את החסימה המלאה ואת זהות השחקן, ושומר אירוע נפרד `blocked_pass` באותה טרנזקציה עם המצב. אין ערכי קוביות מומצאים. השעון והבוט משתמשים במסלול התור הרגיל; לתור הבא ניתן זמן התחלה חדש. גם הבוט המקומי מדלג בלי בקשת קוביות. לאחר דילוג מקומי לחיצה כפולה של האדם אינה מטילה בתור היריב.
- נוספה מיגרציה `game.0023_gameevent_blocked_pass`, שמוסיפה את סוג האירוע ל־choices של `GameEvent`. היא לא הורצה. פריסה דורשת את קוד שרת המשחק, החזית וצרכני ההיסטוריה/הניתוח התואמים, עם המיגרציה. תיקוני הקובייה חלים על **כל אורך סדרה**, ולא רק על הדוגמה ל־3.

## מקורות

- `backend/game/engine.py`, `consumers.py`, `ai_consumer.py` — בדיקת הקובייה, ניקוד החדר ופעולת הבוט.
- `frontend/src/lib/backgammon/engine.ts` — כלל הקובייה, ניקוי הקבלה ודילוג בלי הטלה מול בר חסום לגמרי.
- `GameScreen` → `GameBoard` → `Board` — העברת הקשר הסדרה ופתרון התור החסום; הודעת הדילוג משתמשת ב־GuidanceBanner הקיים עם טקסט מוגדל שמציין במפורש שלא בוצעה הטלה.
- `gameContext.tsx`, `localGameContext.tsx` — חסימת פעולות הכפלה ישירות לפי אותו כלל.
- [חוקי USBGF: קובייה מתה ו־Crawford](https://usbgf.org/tournament-rules/rules-for-in-person-play/).

## אימות

ESLint ממוקד לקבצי החזית שנערכו הסתיים ללא שגיאות, עם ארבע אזהרות קיימות באפקטים של `GameBoard` ו־`GuidanceBanner`. בדיקת TypeScript של חזית המועדון עברה. TypeScript מלא נעצר באותן חמש שגיאות קיימות בקובצי רינדור שלא נערכו: שלוש שגיאות אי־פתרון `pixi.js` ושני פרמטרים חסרי טיפוס נגזרים. לא בוצעה התקנת תלות. לאחר שהמפרש לא נמצא בסביבת ה־sandbox, בדיקת AST סטטית עברה לכל 16 קובצי Python ששונו או נוספו באמצעות `C:\Users\User\AppData\Local\Programs\Python\Python312\python.exe` בסביבת ההרצה המאושרת. לא בוצעו import של היישום, הרצת tests או גישה למסד; זו אינה בדיקת Django או אימות התנהגות.

סקירה סטטית עצמאית לא העלתה ממצא נוסף במימוש. נוספו בדיקות למנוע, להעברת הניקוד עד לכפתור, לחובת ההטלה לאחר קבלה, לבוט ולחסימה מלאה בשני הצבעים. הן לא הורצו. tests/build, משחק מקוון, אימות היסטוריה ו־TXT, ומובייל פיזי נשארים לאימות המשתמש. אין טענה שהרצף במשחק המדווח שוחזר.

המשתמש מריץ בסביבת הבדיקות המוגדרת ועוצר בכשל הראשון. בצד Python נדרש interpreter פעיל עם תלויות הפרויקט:

```powershell
Set-Location 'C:\Users\User\Desktop\projects\backgammon\Backgammon Game\backend'
python manage.py test game.tests.gameplay.test_blocked_pass game.tests.gameplay.test_cube_rules game.tests.gameplay.test_mode_lifecycle game.tests.integration.test_formats game.tests.test_ai_socket game.tests.analysis.test_blocked_pass
```

```powershell
Set-Location 'C:\Users\User\Desktop\projects\backgammon\Backgammon Game\frontend'
pnpm test src/lib/backgammon/doubling.test.tsx src/lib/backgammon/engine.blockedPass.test.tsx src/lib/backgammon/engine.test.tsx src/components/GameScreen/GameBoard.cube.test.tsx src/components/GameScreen/GameScreen.bar.test.tsx src/components/GameScreen/GameScreen.test.tsx src/services/gameContext.test.tsx src/services/localGameContext.test.tsx src/components/MatchDetail/ReplayPlayer.blockedPass.test.tsx
pnpm build
```

במשחק חי יש לבדוק שני צבעים ויעדי סדרה שונים: 2→4 מותר ו־4→8 חסום בסדרה ל־3 בניקוד0–0; הטלה חסומה → הכפלה → קבלה → ההטלה הראשונה של המציע בתור החדש; תור Open Sage עם קובייה מתה; ובר חסום לגמרי כשההעדפה האוטומטית כבויה. בדילוג המלא אין בקשת קוביות, הודעת החסימה מופיעה ואירוע `blocked_pass` מתועד בלי קוביות. השחקן הבא ממשיך כרגיל, בלי בקשה כפולה או דילוג נוסף שגוי.

## המשך נפרד

הגדלת הטקסט ממוקדת בהודעות המשחק, לפי הבהרת המשתמש, ומתועדת ב־[פריסה והודעות](GAME_LAYOUT.he.md). ניגודיות האבנים והבר עדיין לא שונתה. לשגיאת הורדת ה־TXT המסוימת עדיין דרושה תשובת `/record` המלאה; התאמת פורמט המקור לדילוג ללא הטלה מתועדת ב־[ייצוא הניתוח](../../backgammon-tournaments/docs/ANALYSIS_TXT_EXPORT.he.md). תיעוד המקור שומר את הדילוג, וב־MAT נוסף מניין דילוגים בכותרת ללא שורת קוביות מומצאת; ייבוא ממשי ב־XG לא אומת. המשחק החסר נמצא בידי המשתמש.

לבדיקות התאמת הניתוח והייצוא, בסביבות המשתמש המוגדרות ובנפרד מבדיקות המשחק:

```powershell
Set-Location 'C:\Users\User\Desktop\projects\backgammon\backgammon-analysis-service'
python manage.py test analysis.tests.test_blocked_pass
```

```powershell
Set-Location 'C:\Users\User\Desktop\projects\backgammon\backgammon-tournaments'
pnpm exec vitest run src/services/__tests__/matchRecordTimeline.blockedPass.test.ts src/services/__tests__/analysisMat.test.ts src/services/__tests__/analysisText.test.ts
pnpm build
```
