# מעבר הטורנירים והמשחק לתחום משותף

ההכנה המקומית אושרה ב־12.10.2026. המעבר המלא מתוכנן לבוקר 13.10.2026, בהפעלה מפורשת. לא בוצעו פרסום, SSH, שינוי שרת או פריסה.

## הכתובות לאחר המעבר

| שימוש | כתובת |
| --- | --- |
| כניסה למועדון | `/6b/`, המפנה ל־`/6b/tournaments/` |
| טורנירים, חשבון, חנות וניתוח | `/6b/tournaments/` |
| ממשק המשחק | `/6b/backgammon/` |
| תחום האפליקציה המותקנת | `/6b/` |
| manifest משותף | `/6b/backgammon/manifest.webmanifest` |

מזהה האפליקציה נשאר `/backgammon/`, באותו origin. הוא מזהה התקנה ולא תחום ניווט. ה־API, ה־WebSocket, האדמין, static/media של Django ויתר האפליקציות נשארים בנתיבים הקיימים. אין להעביר את DBDome או להחליף את קובץ Nginx הראשי כולו.

## ניתוב Nginx

קובץ [הניתוב](nginx.production.locations.conf) נועד להיטען מתוך שרת HTTPS הקיים באמצעות:

```nginx
include /etc/backgammon-docker/nginx.production.locations.conf;
```

לפני הוספתו מסירים מהשרת הראשי רק את הבלוקים שהוא מחליף: ממשקי `/backgammon/`, `/tournaments/`, `/tournaments-admin/`, `/backgammon/static/`, `/tournaments-static/`, `/tournaments-media/` ו־`/tournaments-ws/`, ואת בלוקי התאימות החופפים אם קיימים. שאר בלוקי ה־API וה־WebSocket נשארים במקומם. הוספת include לצד בלוקים כפולים תיכשל ב־`nginx -t`.

הניתוב שומר query strings ומפנה קישורים ישנים ל־`/6b/` עם 308. על דפדפן לשמר גם את ה־fragment; יש לבדוק בפועל קישור כניסה למשחק לפני פתיחה לציבור. כתובות manifest ישנות וקובצי workers ישנים מוגשים ללא הפניה, כדי לאפשר עדכון התקנות ותאימות למנויי Push קיימים. ה־worker הישן של המשחק פורש ואינו מנווט או סוגר משחק פעיל.

## תצורת השרת החי

עדכון התמונות הרגיל משמר את תצורת Compose החיה. שינוי קובץ `compose.production.yaml` במקורות לבדו אינו משנה את כתובות ההפניה של קונטיינרים שכבר קיימים. במסגרת המעבר צריך לעדכן גם את התצורה הקנונית החיה בכל שירותי ה־API והעובדים המתאימים:

```text
GAMELINK_FRONTEND_URL=<PUBLIC_ORIGIN>/6b/backgammon
ACCOUNT_FRONTEND_URL=<PUBLIC_ORIGIN>/6b/tournaments
```

`GAMELINK_TOURNAMENTS_FRONTEND_URL` נשאר origin בלבד. שרת המשחק מוסיף אליו `/6b/tournaments/`. משתני API, מפתחות, עוגיות התחברות, נתונים ו־mounts נשמרים.

כלי [הכנת ההצעה](../Backgammon%20Game/deploy/workspace/operations/prepare_sixb_transition.py) מקבל עותק של Nginx וקובץ JSON קנוני של התצורה החיה, ומכין תיקייה חדשה עם מקור, הצעת ניתוב, קובץ maintenance, שני snapshot-ים פרטיים, include ו־hashes. הוא אינו מפעיל Nginx או Docker ואינו פונה לשרת:

```powershell
python 'Backgammon Game/deploy/workspace/operations/prepare_sixb_transition.py' --nginx-file '<עותק מקומי של Nginx>' --compose-file '<snapshot JSON נוכחי>' --output-dir 'artifacts/6b-transition-20261013'
```

קובץ Compose בהצעה עדיין מכיל את מזהי התמונות הנוכחיות. הוא אינו חבילת פריסה מוכנה להפעלה. בזמן המעבר יש לשלב את שינויי הכתובות עם מזהי התמונות החדשות שנבנו ונבדקו, לאמת את התצורה מול הקונטיינרים החיים, ולשמור את המקור לשחזור. ה־snapshot-ים פרטיים ואינם מיועדים ל־Git.

## סדר המעבר בבוקר

1. להשלים את בדיקות המשתמש והבניות משני הממשקים ומהשרתים. לבנות ולזהות את תמונות הפריסה מאותו מקור שנבדק; אין להשתמש בהמשך של פריסה ישנה שנבנתה לנתיבים הקודמים.
2. לקרוא את Nginx והתצורה החיה בפועל, להכין את ההצעה ולבדוק diff שמוגבל לניתוב המועדון ולשני משתני הכתובות. לוודא שהפורט של כל frontend מתאים לשרת בפועל.
3. לוודא שאין משחקים פעילים או ממתינים ושמסירות המשחק תקינות. להיכנס ל־maintenance עבור כל נתיבי המועדון הישנים והחדשים וה־API; לעצור עובדים ולבדוק שוב שאין משחקים פעילים. לבצע גיבוי לפי נוהל הפריסה הקיים.
4. בתוך maintenance לבצע מעבר מתואם של התמונות, משתני ההפניה ו־Nginx. לבדוק `nginx -t` לפני reload. מנגנון ה־maintenance המעודכן מסוגל להרחיב את ה־include המנוהל לקובץ זמני ולהגן גם על `/6b/`.
5. לבדוק מתוך השרת את ה־API, שני הממשקים, deep links, manifest, אייקונים ו־workers. לבדוק שהנתיבים הישנים מפנים לחדשים ושנתיבי API/WebSocket אינם מופנים.
6. לבדוק התחברות קיימת, כניסה למשחק וחזרה למועדון, משחק נוסף, ניתוח ותזכורת Push. להפעיל עובדים ולפתוח לציבור רק לאחר האימות; לשמור קבלה שמצביעה על קובץ Compose החדש ועל קובץ Nginx הראשי.
7. לבדוק במכשיר שההתקנה עודכנה ל־scope `/6b/`. עדכון ה־manifest אינו מיידי; אם הדפדפן לא עדכן את ההתקנה, לבדוק עדכון או התקנה מחדש בלי למחוק נתוני אתר.

כל פקודת שרת תינתן ותיבדק בנפרד בבוקר. כלי ההכנה ותהליך הפריסה הרגיל לבדם אינם מבצעים את המעבר המתואם הראשון. אם שינוי תצורה או תמונות נכשל, נשארים ב־maintenance ומחליטים לפי שלב השחזור; אין לשחזר נתונים אוטומטית אחרי שחזרו כתיבות.

## פקודות בדיקה למשתמש

מתוך `backgammon-tournaments`:

```powershell
pnpm exec vitest run src/services/__tests__/push-worker.test.ts
```

```powershell
pnpm build
```

מתוך `Backgammon Game/frontend`:

```powershell
pnpm test
```

```powershell
pnpm build
```

מתוך `Backgammon Game/backend`, בסביבת הבדיקות הקיימת:

```powershell
python manage.py test game.link
```

מתוך `backgammon-tournaments-backend/tournaments`, בסביבת הבדיקות הקיימת:

```powershell
python manage.py test frontend.test_push frontend.test_tournament_reminders frontend.test_fixture_push_queue
```

את בדיקות כלי הפריסה וה־maintenance יש להריץ גם הן בסביבה הקיימת לפני שימוש בשרת:

```powershell
python -m unittest discover -s 'Backgammon Game/deploy/workspace/operations' -p 'test_release*.py'
```

בדיקות דפדפן ומובייל צריכות לכלול גם שהמעבר ל־DBDome ולמערכות האחרות מציג הקשר מחוץ לאפליקציה; ה־scope אינו מנגנון הרשאה או חסימה של קישורים חיצוניים.

## אימות מקומי

TypeScript עבר בשני הממשקים. ESLint ממוקד עבר ללא שגיאות; קיימות שלוש אזהרות React בשורות שלא השתנו. `nginx -t` מקומי עבר בשלושת קובצי הניתוב, מול Nginx 1.31.6 ל־Windows עם קובצי מעטפת. תחביר 12 קובצי Python, שלושה workers ושני מפעילי PowerShell עבר. בדיקת whitespace עברה עם התחשבות ב־CRLF של Windows. שינויי קובצי הבדיקות הוגבלו לציפיות הנתיבים שאושרו. tests, build, דפדפן, מובייל והפעלת כלי ההכנה מול תצורה חיה עדיין דורשים אימות. בדיקת Nginx מקומית אינה אימות לקובץ הראשי או לגרסת Nginx בשרת.
