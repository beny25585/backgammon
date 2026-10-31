# הודעות משחק מאוירות ב־Pixi וב־Motion

## כל הכניסות מהבר חסומות — 31.10.2026

לאחר צילום הודעת הטקסט, המשתמש אישר להכין איור של אבן על הבר מול שש כניסות סגורות, ולאחר הצגתו אישר ב„כן” את שילובו עם Motion. האיור השקוף `frontend/public/assets/notices/all-entries-blocked.png` נוצר ב־imagegen עם הכיתוב `ALL ENTRIES BLOCKED / NO ROLL`.

השינוי במוצר מצומצם ל־PNG ולמיפוי `guidance.barClosed` ו־`guidance.barClosedOpponent` ב־`BoardActions`. הם משתמשים ב־`IllustratedTurnNotice` וב־Pixi/Motion הקיימים. העיגון נשאר לפי השחקן החסום, והטקסט הנגיש נשאר בתרגומים הקיימים. המנוע, `blocked_pass`, העברת התור ללא הטלה, מזהי האירועים ודדליין שלוש השניות לא שונו.

אימות: TypeScript מלא ו־ESLint לקובץ ששונה עברו ללא שגיאות או אזהרות. סקירה עצמאית לא מצאה ממצא נוסף או צורך לשנות בדיקות רק עבור ייצוג האיור. בתצוגת Chrome מקומית עם `LocalGameProvider`, המנוע והלוח בפועל נזרעו מצבים חוקיים עם שש כניסות סגורות. פעולת `rollDice` הקיימת העבירה תור באמצעות `blocked_pass`; בכל שש התצוגות נצפו אפס בקשות קוביות ואפס רכיבי קוביות. נבדקו שחקן לבן, שחקן שחור, הודעת יריב, טלפון בדפדפן 390×844, מסך נמוך 915×350 והפחתת תנועה. בכל המקרים נצפה איור בצד המתאים, טקסט נגיש יחיד, פקיעה לפי הדדליין הקיים, ללא שגיאות JavaScript, בקשות שנכשלו או גלילה חורגת. בהפחתת תנועה נמדדה דהייה ללא transform.

- [צילום מתוך הלוח](../../artifacts/closed-bar-notice-preview-20261031/desktop.png), [צילום טלפון בדפדפן](../../artifacts/closed-bar-notice-preview-20261031/phone.png), [מסך נמוך](../../artifacts/closed-bar-notice-preview-20261031/short-landscape.png), [סרטון](../../artifacts/closed-bar-notice-preview-20261031/closed-bar-motion.webm).
- [מדידות והעברת תור ללא בקשת קוביות](../../artifacts/closed-bar-notice-preview-20261031/evidence.json), [האיור והנחיית היצירה](../../artifacts/closed-bar-notice-preview-20261031/PROPOSAL.he.md).
- תצוגה מקומית: `http://127.0.0.1:5192/closed-bar-preview`; הפעלה משורש הסביבה: `node artifacts/closed-bar-notice-preview-20261031/server.mjs`.

זו תצוגה עם רכיבי המוצר ונתוני דוגמה, ולא משחק שרת חי או בדיקת מכשיר פיזי. tests/build, משחק חי ומכשיר פיזי נשארים למשתמש. אין Git, פריסה או שינוי מסד נתונים. פקודות המשתמש מתוך `Backgammon Game/frontend`, אחת אחרי השנייה ועצירה בכשל:

```powershell
pnpm test src/services/localGameContext.test.tsx src/services/gameContext.test.tsx
pnpm build
```

## הודעת מהלך יחיד אוטומטי — 31.10.2026

המשתמש הציג את הודעת `guidance.forced`, ביקש איור, הצגה בצד שלו ומשך קריאה ארוך יותר, ולאחר הצגת האיור וההצעה אישר „כן”. מומש ההיקף שאושר:

- האיור השקוף `frontend/public/assets/notices/only-one-move.png` מציג אבן, מסלול זהוב יחיד וסמל הפעלה, עם `ONLY ONE MOVE / AUTO PLAY`. נוצר בכלי imagegen המובנה; [הנחיית היצירה וההצעה המקורית](../../artifacts/forced-notice-preview-20261031/PROPOSAL.he.md).
- `BoardActions` משתמש ברכיב Pixi/Motion המשותף גם עבור `guidance.forced`; ה־variant עובר לפי ההודעה. האיור מעוגן מעל הקוביות בצד השחקן, גם כשצופים כשחור. הקוביות וכפתורי ביטול ואישור נשארים במקומם.
- `useForcedMoveNotice` שומר אירוע עם מזהה ודדליין לשלוש שניות, פעם אחת להטלה. תנועה, סיום הרצף והעברת התור אינם מעלימים או מאריכים אותו. עדיפות להודעת אין מהלכים, ופתיחה/סיום משחק או שינוי חדר/ניקוד מנקים את האירוע. הטלה חדשה מקבלת אירוע חדש; מיון קוביות ו־undo אינם מתחילים אותו מחדש.
- זמן ביצוע המהלכים נשאר 200ms. העברית והאנגלית בטקסט הנגיש עודכנו לניסוח ניטרלי: „מהלך חוקי יחיד — משחק אוטומטי” / `Only one legal move — automatic play.`
- בדיקות `GameBoard.test.tsx` עודכנו לצד השחקן, לעיגון, לשמירה אחרי `applyMove` והעברת תור, לפקיעה ולהופעה בהטלה חדשה בשני הצבעים. ציפיית התרגום ב־`GuidanceBanner.test.tsx` עודכנה לניסוח המאושר. הבדיקות לא הורצו בידי העוזר.

אימות שבוצע: TypeScript מלא עבר. ESLint לשמונת קובצי TypeScript/TSX ששונו עבר ללא שגיאות; שלוש אזהרות `set-state-in-effect` קיימות ב־GameBoard נשארו. יתר שבעת הקבצים ללא אזהרות. סקירה עצמאית לא מצאה ממצא נוסף לאחר הפרדת כפתור האישור ממעטפת ההודעה.

בתצוגת דפדפן עם רכיבי המשחק בפועל ונתוני דוגמה נצפו שני מהלכים אוטומטיים והעברת תור. האיור נשאר בצד השחקן ב־350ms, ב־1500ms וב־2800ms, ופקע אחרי הדדליין לפני מדידת 3150ms. הופעה חוזרת, החלפת scope וסיום משחק נצפו. נבדקו מחשב, שחקן שחור, טלפון בדפדפן 390×844, מסך נמוך 915×350 והפחתת תנועה; ללא שגיאות JavaScript, בקשות שנכשלו או גלילה חורגת. במצב הפחתת תנועה נמדדה דהייה בלבד. כפתור האישור שמר בדיוק על מיקומו ועל מידותיו לפני ואחרי היעלמות האיור.

- [צילום בצד הקוביות שלך](../../artifacts/forced-notice-preview-20261031/desktop-with-dice.png), [צילום טלפון בדפדפן](../../artifacts/forced-notice-preview-20261031/phone.png), [צילום מסך נמוך](../../artifacts/forced-notice-preview-20261031/short-landscape.png), [סרטון](../../artifacts/forced-notice-preview-20261031/forced-notice-motion.webm).
- [מדידות תצוגה](../../artifacts/forced-notice-preview-20261031/evidence.json), [מיקום אישור לפני ואחרי](../../artifacts/forced-notice-preview-20261031/confirm-layout.json).
- תצוגה מקומית: `http://127.0.0.1:5189/forced-preview`; הפעלה משורש הסביבה: `node artifacts/forced-notice-preview-20261031/server.mjs`.

לא הורצו tests או build. משחק שרת חי ומכשיר פיזי נשארים לאימות המשתמש. אין Git או פריסה. התיקון המוצע לסיווג הודעת אין מהלכים בעקבות אכילה, שמתואר להלן, נשאר בנפרד וממתין לאישור.

פקודות המשתמש מתוך `Backgammon Game/frontend`, אחת אחרי השנייה ועצירה בכשל:

```powershell
pnpm test src/components/GameScreen/GameBoard.test.tsx src/components/GuidanceBanner/GuidanceBanner.test.tsx
pnpm build
```

## השלמת אימות הודעת אין מהלכים — 31.10.2026

המשך באותו יום, לבקשת המשתמש לראות את התקלה לאחר שלא הצליח לשחזר: הוכן [שחזור דרך LocalGameProvider האמיתי](../../artifacts/notice-hit-repro-20261031/README.he.md), עם מצב פתיחה חוקי, קוביות קבועות ויריב מהיר. `rollDice` יצר את הודעת אין המהלכים ו־`makeMove` ביצע אכילה חוקית; לא הוזרקו הודעה או בר אחרי תחילת המסלול. אותו id ודדליין נשמרו בזמן שהאיור והטקסט התחלפו בעקבות האכילה. [סרטון](../../artifacts/notice-hit-repro-20261031/notice-changes-after-hit.webm), [לפני](../../artifacts/notice-hit-repro-20261031/before.png), [אחרי](../../artifacts/notice-hit-repro-20261031/after.png). זו ראיית שחזור מקומי מבוקר, ולא משחק שרת חי. נמצא גם גבול חשוב: הבוט המקומי ממתין 1500ms לפני ההטלה ועוד 1500ms לפני המהלך, ולכן אכילתו צפויה אחרי פקיעת ההודעה; הסרטון אינו מייצג את תזמון הבוט. לא נערך קוד מוצר והתיקון המוצע נשאר ממתין לאישור.

המשתמש אישר להמשיך מנקודת העצירה: השלמת אימות `NO LEGAL MOVES / TURN PASSED`. האיור `frontend/public/assets/notices/no-legal-moves.png` והרכיב המשותף `IllustratedTurnNotice` כבר קיימים בקוד. המיפוי הנוכחי כולל `guidance.noMoves` ו־`guidance.noMovesOpponent`, וכן את שני מצבי הודעת הבר. אלה הודעות על אירוע שכבר התרחש; מצב הלוח החי אינו אמור לשנות את תוכנן.

- ESLint ממוקד ל־`BoardActions`, `IllustratedTurnNotice` ו־`turnNoticeRenderer` עבר ללא שגיאות או אזהרות. TypeScript מלא עבר בהרצה עם גישת קריאה לחבילת Pixi המותקנת; בסביבה המוגבלת בלבד החבילה לא נפתרה.
- נצפו רכיבי הלוח בפועל עם נתוני הדגמה: מחשב 1440×900, טלפון בדפדפן 390×844 בעברית/RTL, ומצב הפחתת תנועה. בשניהם האיור מופיע מעל קוביות השחקן המתאים, עם טקסט נגיש מתורגם יחיד. אין שגיאות JavaScript, בקשות שנכשלו או גלילה חורגת.
- נמדדה כניסה בהופעה הראשונה ויציאה סמוך לדדליין הקיים. בהפחתת תנועה נמדדה דהייה ללא transform. גם הודעת היריב, החלפה מהירה בין שני האיורים ועדכון חוזר של אותו אירוע נצפו; נשמר canvas יחיד והאיור האחרון תואם לבקשה האחרונה.
- נמצא ושוחזר פגם בסיווג: הודעת אין מהלכים פעילה מתחלפת לאיור בר חסום אם היריב מכה את השחקן במהלך חלון ההודעה. `GameBoard` מסווג באמצעות `state.bar` החי, ולא snapshot של האירוע. [ראיות](../../artifacts/turn-notice-preview-20261031/evidence.json), [צילום לאחר האכילה](../../artifacts/turn-notice-preview-20261031/after-opponent-hit.png).
- הוכן [תיקון ממוקד לעיון](../../artifacts/turn-notice-preview-20261031/proposed-snapshot-fix.patch): לשמור `blockedOnBar` עם `NoMovesMessage` במקורות המשחק המקומי והמקוון ולצרוך אותו ב־`GameBoard`. חמשת קובצי המוצר טרם נערכו; ההחלה ממתינה לאישור לפי סעיף 1 ב־AGENTS.md.
- [צילום מחשב](../../artifacts/turn-notice-preview-20261031/desktop.png), [צילום טלפון בדפדפן](../../artifacts/turn-notice-preview-20261031/phone.png), [סרטון Motion](../../artifacts/turn-notice-preview-20261031/no-legal-moves-motion.webm). התצוגה החוזרת היא `http://127.0.0.1:5188/notice-preview?notice=moves`; ההפעלה מתועדת בהמשך. מארח הדפדפן המובנה לא היה זמין, ולכן נשמרו ראיות בדפדפן Chrome מקומי באמצעות כלי התצוגה.
- לא הורצו tests או build, ולא בוצעו Git, פריסה או שינוי מסד נתונים. משחק שרת חי ומכשיר פיזי נשארים לאימות המשתמש. לאחר אישור והחלת התיקון יש לחזור על תרחיש האכילה ולאמת שהאיור והדדליין נשארים של האירוע המקורי.

## אישור והיקף

29.10.2026 — המשתמש בחר ואישר את דוגמה 3: אבן בהירה עם סמל חסימה אדום, חץ זהוב והכיתוב `CAN'T ENTER / TURN PASSED`. לאחר הבחירה ביקש במפורש לשלב במשחק ולהציג את התוצאה. ההיקף הוא ההודעה `guidance.barBlocked` בלבד. הודעת היריב, בית סגור ללא הטלה, אין מהלכים ומהלך אוטומטי נשארים בתצוגה הקיימת עד בחירה נפרדת.

בהמשך המשתמש דיווח שבסרטון נראה שהאיור רק מופיע, וביקש במפורש לבצע את האנימציה ב־Motion. בבדיקת המקור נמצא שבגרסה הראשונה הכניסה הראשונה דולגה, וביתר הכניסות שינוי הגודל היה 5% בלבד במשך 200ms. הקריאה ל־Motion שימשה אז רק לעקומת תזמון. המימוש הוחלף להלן ב־`animate()` של Motion בפועל.

## מימוש

- האיור המאושר בודד לרקע שקוף באמצעות כלי `imagegen` המובנה. נכס היישום: `frontend/public/assets/notices/bar-blocked.png`, בגודל 1586×992; כ־1.55MB. הפינות שקופות והכיתוב באנגלית הוא חלק מהתמונה, לפי הבקשה.
- `BoardActions` משתמש ב־`PixiBarBlockedNotice` רק להודעה שנבחרה. הרכיב נשאר מותקן בין אירועים, כדי להשתמש שוב באותו Application קטן. שאר ההודעות והחלטת הכפלה ממשיכות דרך `GuidanceBanner`.
- האיור מעוגן מעל הקוביות, וגדל כלפי מעלה מתוך העוגן הקיים. אין הזזה של הקוביות או של פקדי התור.
- האנימציה מבוצעת באמצעות `animate()` של Motion על מעטפת משותפת לתמונת הגיבוי ולקנבס. כניסה, כולל בפעם הראשונה: עלייה של 10px, שינוי גודל מ־90% ל־100% ודהייה במשך 250ms. יציאה: ירידה של 6px, הקטנה ל־96% ודהייה ב־180ms האחרונים של זמן ההודעה הקיים. בהעדפת הפחתת תנועה נשארת דהייה בלבד.
- מוכנות Pixi אינה מתחילה אנימציה חדשה; אותו מזהה אירוע שומר את זמן ההתחלה. אחרי חזרה לטאב מתבצע סנכרון לזמן שכבר עבר. Pixi מצייר את האיור הסטטי ומטפל בשינוי גודל בלבד; לולאת האנימציה הידנית שלו הוסרה.
- מזהה האירוע הקיים ו־`expiresAt` מקומי עוברים מה־hook לשכבת התצוגה. הדדליין הוא נתון חזותי בלבד; משך שלוש השניות, השהיית הגילוי, תורים, שעונים, בוט ומנוע המשחק לא שונו.
- אין לולאת ציור בזמן ההחזקה או בטאב מוסתר. אתחול מאוחר אינו מחזיר הודעה שכבר הוסרה. משאבי הרינדור המקומיים מנוקים בפירוק, בלי למחוק תמונות משותפות או משאבים של הלוח.
- Canvas דקורטיבי ללא קליטת מגע. התיאור הנגיש ממשיך דרך `t()` בעברית ובאנגלית; הוא אינו מוצג כטקסט נוסף. תמונת גיבוי משתמשת באותו איור כש־Pixi אינו זמין.

## אימות

- TypeScript מלא עבר כאשר ניתנה לתהליך קריאת קובצי חבילת Pixi המותקנת. ההרצה בסביבה המוגבלת נתקלה בחסימת קריאה של metadata לחבילה.
- ESLint ממוקד: ללא שגיאות; ארבע אזהרות effect קיימות ב־`GameBoard` וב־`GuidanceBanner`.
- לאחר המעבר ל־Motion: TypeScript מלא עבר שוב; ESLint בשני קובצי `TurnNotice` עבר ללא שגיאות או אזהרות. סקירת מחזור החיים לא מצאה תקלה נוספת בהפעלה חוזרת, בדדליין או בניקוי המשאבים.
- תצוגת דפדפן מקומית עם רכיבי הלוח בפועל ונתוני הדגמה: [צילום מחשב](../../artifacts/bar-notice-preview-20261029/desktop.png), [צילום טלפון בדפדפן](../../artifacts/bar-notice-preview-20261029/phone.png), [ראיות רינדור](../../artifacts/bar-notice-preview-20261029/evidence.json). התצוגה אינה משחק שרת חי ואינה בדיקת מכשיר פיזי.
- בשני הצילומים אושר רינדור Pixi בפועל, ללא שגיאות JavaScript, בקשות שנכשלו או גלילה חורגת. מעטפת המשחק והסיבוב לאורך מגיעים מקוד היישום. [סרטון כניסה ויציאה](../../artifacts/bar-notice-preview-20261029/notice-animation.webm). סריקת העיצוב הממוקדת לא החזירה ממצאים.
- הסרטון הקודם נשמר כראיה לגרסה הראשונית. סרטון המימוש החדש: [אנימציית Motion](../../artifacts/bar-notice-preview-20261029/notice-motion-animation.webm); מדידות הכניסה והיציאה: [ראיות Motion](../../artifacts/bar-notice-preview-20261029/motion-evidence.json).
- מדידת ההופעה הראשונה בוצעה לאחר שהלוח נטען, כשהודעת הבר טרם יצרה renderer: במחשב נמדדו opacity של 0.727 ב־141ms והגדלה מ־90% ל־100%; בטלפון נמדדה התקדמות כבר ב־64ms. היציאה וההסתרה התרחשו סביב שלוש שניות. במצב הפחתת תנועה לא נמדד transform. לא נרשמו שגיאות JavaScript או בקשות שנכשלו. התצוגה האוטומטית ממתינה גם היא למוכנות הלוח לפני ההודעה הראשונה; מדידת פתיחת יישום קר נשמרה בנפרד ואינה מסלול ההודעה במשחק שכבר נטען.
- tests ו־build לא הורצו בידי העוזר. לא בוצעו Git או פריסה.

תצוגה חוזרת מקומית: `http://127.0.0.1:5188/notice-preview`. הפעלה מחדש משורש סביבת העבודה:

```powershell
node artifacts/bar-notice-preview-20261029/server.mjs
```

המשתמש מריץ מתוך `Backgammon Game/frontend`, ועוצר בכשל:

```powershell
pnpm test src/components/GameScreen/GameBoard.test.tsx src/components/GuidanceBanner/GuidanceBanner.test.tsx src/services/gameContext.test.tsx src/services/localGameContext.test.tsx
pnpm build
```

בבדיקה ידנית יש לוודא שההודעה מופיעה מעל הקוביות של השחקן החסום, שהיריב ממשיך ללא המתנה, שהודעה חדשה מנפישה פעם אחת ושהחלפת חדר מנקה הודעה ישנה. יש להשלים אימות במכשיר נייד אמיתי.

## הוראת עיבוד האיור

מקור: דוגמה 3 שאושרה בשיחה. מצב עבודה: עריכת תמונה בכלי `imagegen` המובנה, עם `transparent_background: true`.

```text
Edit the supplied approved game badge. Precise background extraction only: REMOVE the entire dark felt backdrop and every large backgammon triangle at the outer sides. Keep the central approved badge as a clean transparent cutout, preserving its exact design, color, proportion, edges, bevels and lettering: the coral circle-and-slash over the ivory round checker, gold burst points behind that emblem, hooked gold turn arrow, main title CAN'T ENTER and subtitle TURN PASSED. Do not redesign or add/remove any element of that central badge. Preserve solid dark edging and shadows that belong to the badge, and transparent open holes between letters and inside shapes. Crop the canvas closely around the complete central badge with approximately 3% transparent safe padding on all four sides. This is a production PNG sprite for a PixiJS in-game notification. True alpha transparency, no checkerboard pattern, no baked background, no drop shadow spanning the entire canvas. Exact English text must remain flawlessly legible. Only isolate the existing artwork.
```
