# בדיקת כל שירותי האפליקציה לפני מעבר לפרודקשן

לבנייה וקבלה של הגרסה המועמדת בשלבים 1–4 בפקודה אחת: [RELEASE_VALIDATION.he.md](RELEASE_VALIDATION.he.md). היא כוללת בניית תמונות חדשות ואיסוף אוטומטי של הדוחות. ההוראות בהמשך מסמך זה מתייחסות להרצה ההיסטורית `backgammon-rehearsal-20261005t184922z`. האתר הרגיל ב־443 דורש מעבר נפרד; פרסום תיקונים ב־Git אינו ראיה להפעלתם ב־Docker.

## מקור קבוע ואימות ההרצה הקיימת

המקור היחיד הוא `deploy/workspace/docs/tournament-e2e` במאגר `beny25585/backgammon`, בענף `master`. תיקיות `docs/tournament-e2e*` בשורש סביבת העבודה שומרות דוחות והגדרות פרטיות; המפעילים הישנים מפנים למקור הזה. אין להעתיק שוב את קוד הכלים או ליצור חבילת tar.

הרצת `20261006T150505620Z-534a2ca2` הושלמה בדפדפנים. לא יוצרים עבורה מסדים, seed או baseline חדשים. התיקון שומר דוח גם בכשל, מאמת בנפרד תוצאות וארנק ומברר אם משימת האנליזה שנכשלה שייכת לחדר בטורניר. הדוח הכולל עדיין נכשל אם יש תקלה חדשה ברקע. שידורים חוזרים מבוצעים רק לאחר ששתי בדיקות המסד הראשונות עברו.

המבנה הקיים בשרת הוא `/home/dev/backgammon-project`: המקור ב־`sources/backgammon`, הפריסה ב־`deploy/backgammon-deploy`, הכלים הפעילים ב־`tools`, הדוחות ב־`reports` ומצב הבדיקה ב־`backups/backgammon-backups`. בדיקת הנתיבים בשרת אימתה שהנתיבים הישנים ב־`/home/administrator` והנתיבים החדשים מפנים לאותן תיקיות, וששני ה־APIs קוראים קובץ מושב זהה. משאירים את קישורי התאימות כל עוד הקונטיינרים וההגדרות משתמשים בהם.

לאחר בדיקות המשתמש ופרסום commit מאושר, משתמשים ב־checkout הקיים בשרת כמקור הכלים. `APPROVED_COMMIT` הוא SHA מלא של מקור נקי ומאושר. אין ליצור clone נוסף או להחליף את ה־checkout כדי לעקוף מקור מלוכלך. עדכון מקור השרת נעשה במסגרת פרסום מאושר של הפרויקט; הפקודות הבאות דורשות שכבר נמצא בו ה־commit המתאים. הן עדיין לא בוצעו:

```bash
taskRoot=/home/dev/backgammon-project
taskSource="$taskRoot/sources/backgammon"
taskProject="$taskRoot/deploy/backgammon-deploy/bg-20261005-git-r2"
taskRehearsal="$taskRoot/backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal"
taskTools="$taskSource/deploy/workspace/docs/tournament-e2e"
git -C "$taskSource" remote get-url origin
git -C "$taskSource" status --short
git -C "$taskSource" rev-parse HEAD
python3 -m unittest discover -s "$taskTools" -p '*_test.py'
# ממשיכים רק אם הבדיקות עברו.
sudo -v
python3 "$taskTools/server_rehearsal.py" refresh-tools \
  --tools-revision APPROVED_COMMIT \
  --project "$taskProject" \
  --rehearsal "$taskRehearsal"
```

לעדכון הבא משתמשים באותו מקור ובעותק הכלים הפעיל. `refresh-tools` מסרב למקור מלוכלך, לשינוי מלאי הכלים או לשינוי קוד שמשפיע על ה־APIs הפעילים. הוא מקבל נתיב תאימות רק אם הוא מגיע לאותה תיקייה קיימת במבנה שנבדק. הוא שומר גיבוי ב־`browser-e2e-r2/tool-updates/COMMIT`, מעדכן את כלי האימות והמפעיל בעותק הפעיל, משמר inodes של bind mounts ובודק זהות וחתימות baseline. בכשל הוא מחזיר את הקבצים והזהות הקודמים. אין בניית תמונות או הפעלה מחדש בפעולה הזאת.

לאימות הטורניר שכבר הסתיים ב־PowerShell:

```powershell
.\docs\tournament-e2e-integrations\run-remote-tournament-e2e.ps1 -AuditOnly -RunDirectory '.\docs\tournament-e2e-integrations\runs\20261006T150505620Z-534a2ca2'
```

המפעיל מעלה את הסיכום אל `reports/e2e-tournament-summary.json`, מפעיל את האימות בנתיב הכלים שנשמר במושב השרת ומוריד את הדוחות אל `share-report` של אותה הרצה, גם אם האימות נכשל. עותקי הדוחות בשרת נשמרים ב־`reports/tournament-e2e/RUN_ID`. שני הדוחות נבדקים מול ההרצה, המושב וההפעלה הנוכחית כדי למנוע שימוש בדוח ישן. `server-operations.json` כולל `audit_steps` עם הדוחות ובדיקות שדולגו; `run-summary.json` משלב דפדפן, ביצועים ושרת. בתחילת אימות חדש הסיכום מסומן כממתין, וכשל תקשורת מסומן כאימות שלא הושלם, כדי שלא יישאר בו סטטוס הצלחה קודם. ברירת המחדל של `-ServerRoot` היא `/home/dev/backgammon-project`. SSH ו־sudo עשויים לבקש סיסמה בחלון המשתמש.

בדיקות הכלים במחשב — המשתמש מריץ:

```powershell
$taskTools = '.\Backgammon Game\deploy\workspace\docs\tournament-e2e'
node --test "$taskTools\destination-policy.test.mjs" "$taskTools\source-versions_test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Browser policy tests failed' }
.\backgammon-tournaments-backend\venv\Scripts\python.exe -m unittest discover -s $taskTools -p '*_test.py'
if ($LASTEXITCODE -ne 0) { throw 'Rehearsal tool tests failed' }
```

הסוכן בדק תחביר בלבד. המשתמש הריץ במחשב Windows את 15 בדיקות Node, שכולן עברו, ואת 81 בדיקות Python, שסיימו ב־`OK (skipped=1)` — 80 עברו ובדיקת יצירת קישור תיקייה דולגה. עדיין נדרשים פרסום Git מאושר ועדכון כלי השרת לפני שימוש במפעיל המעודכן. הגדרות פרטיות ודוחות אינם חלק מה־commit.

## 1. תמונת מצב מהשרת

`server_inventory.py` קורא את הקונטיינרים והתמונות, גרסאות המקור, זהות המאזין וכלי הבדיקה, שמות מסדי PostgreSQL, משאבי השרת, שירותי systemd ונתיבי Nginx. הגדרות פרטיות מוצגות רק כסטטוס הגדרה. סיסמאות, מפתחות ופקודות שירות מלאות אינם נכללים בדוח.

```bash
taskRoot=/home/dev/backgammon-project
taskProject="$taskRoot/deploy/backgammon-deploy/bg-20261005-git-r2"
taskRehearsal="$taskRoot/backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal"
taskTools="$taskRoot/tools/backgammon-e2e-tools-comprehensive-5f27bb7bffca-KsvUq4"
taskInventory="$taskRoot/reports/server-inventory.json"
sudo -v
python3 "$taskTools/server_inventory.py" --project "$taskProject" --rehearsal "$taskRehearsal" --output "$taskInventory"
```

יש לבדוק את הדוח לפני ההפעלה: זמינות משאבים, התאמת התמונות לזהות הבדיקה והימצאות `GOOGLE_CLIENT_ID` בהגדרה שנשמרה בשרת. תיקיית הבנייה המקורית עשויה להיות בגרסה הקודמת של הטורנירים; תמונת השירות נבנתה בנפרד מהתיקון `4cae430`. הדוח מציג את שני הדברים במפורש.

## 2. בדיקות הכלים והפעלה

סעיף זה מיועד להקמת בדיקה חדשה בלבד. עבור ההרצה הקיימת משתמשים ב־`refresh-tools` וב־`-AuditOnly` שלמעלה. המשתמש מריץ את הבדיקות. אלה בדיקות מבודדות של כלי ההפעלה; הן אינן מפעילות Docker או פונות למסדי נתונים או לספקי תשלום.

```bash
python3 -m unittest discover -s "$taskTools" -p '*_test.py'
# להמשיך רק אחרי OK:
python3 "$taskTools/rehearsal_integrations.py" enable --project "$taskProject" --rehearsal "$taskRehearsal"
```

הפעולה יוצרת מזהה בדיקה חדש, מנהל בדיקה חדש ושלושה מסדי PostgreSQL חדשים למשחק, לטורנירים ולאנליזה. היא בודקת ש־Redis 10 ו־11 פנויים ומשתמשת בהם. מסדים ונתונים ישנים נשמרים.

הפעולה מפעילה את הממשקים, הקוביות, שרתי המשחק והטורנירים והעובדים, וגם את `analysis-api`, `analysis-worker` ו־`push-worker`. נשמרות תמונות היישומים לפי מזהי התוכן. מפתחות Push, חתימת כרטיסים וטוקן האנליזה חדשים ונשמרים בקבצים פרטיים בשרת. האנליזה נשארת ברשת הפנימית ללא פורט מפורסם. היציאה לרשת ניתנת לעובד Push ולשרת הטורנירים לצורך אימות Google.

ההפעלה מבצעת מיגרציות, בודקת בריאות, מעריכה עמדת פתיחה אמיתית דרך API ה־AI, מאמתת את גשר תוצאות האנליזה, את פעימת עובד Push ואת הגישה לתעודות Google. גיבוי ב־`browser-e2e-r2/before-integrations` מאפשר חזרה למצב הקודם; כשל בשלב ההפעלה גורר ניסיון שחזור אוטומטי.

מזהה Google נלקח מההגדרה שנשמרה בשרת. אם חסר, הפעולה נעצרת לפני עצירת השירותים; אפשר לספק את מזהה הלקוח הציבורי עם `--google-client-id`. כתובת הבדיקה חייבת להיות ב־Authorized JavaScript origins ב־Google Cloud. כניסה אמיתית היא בדיקה ידנית נפרדת.

לפי הבהרת המשתמש, דואר אינו נדרש כרגע. תשלום מול Tranzila דורש מסוף בדיקות שמוגדר אצל הספק; `TRANZILA_ENVIRONMENT=test` כשלעצמו אינו משנה את מצב המסוף. תשלומים נשארים כבויים עד לקבלת מסוף כזה. חיוב קוינס פנימי נבדק בטורניר.

## 3. טורניר של 16 שחקנים על 100 קוינס

להרצה חדשה בלבד, אחרי ההפעלה מורידים את `browser-e2e-r2/server-client.json` אל `docs/tournament-e2e-integrations/server-client.json` ומריצים דרך המפעיל הקבוע:

```powershell
.\docs\tournament-e2e-integrations\run-remote-tournament-e2e.ps1 -ServerManifest $taskManifest -Players 16 -Headed -Comprehensive
```

ההרצה גובה 100 קוינס מכל שחקן, מאמתת 16 חיובים וסך 1,600 קוינס, חוזרת על ההרשמה כדי לבדוק שלא נוסף חיוב, ומשווה את כל היתרות אחרי חלוקת פרס קבוע של 100 קוינס. בונוס ההרשמה הרגיל מממן את הכניסה. זו בדיקת הארנק הפנימי; אין בה עסקת Tranzila.

בנוסף ל־15 משחקים אמיתיים, ההרצה ממתינה עד 45 דקות לסיום כל 15 הניתוחים עם Open Sage, קוראת פירוט ניתוח דרך הגשר המאומת, בודקת הגדרת Google ואתגר הכניסה, ומאמתת הגדרת Push ופעימת עובד ללא תקלות. ספי הביצועים המקוריים נשארים בתוקף. HTTP cache ו־service workers נשארים במצב בדיקת הביצועים המקורית.

הרצת הדפדפנים אינה מוכיחה כניסה אמיתית דרך Google או מסירת Push למכשיר. המשתמש אישר שכניסת Google נבדקה ידנית ועבדה. בדיקת Push למכשיר נמצאת אצל המשתמש ותוצאתה עדיין ממתינה.

## 4. אימות במסדים

המפעיל המקיף כולל העלאת סיכום, אימות שרת והורדת דוחות. `-AuditOnly` חוזר על האימות של הרצה קיימת. הפקודה הישירה נשארת זמינה לטיפול בכשל תקשורת:

```bash
python3 "$taskTools/server_rehearsal.py" audit --project "$taskProject" --rehearsal "$taskRehearsal" --summary "$taskRoot/reports/e2e-tournament-summary.json"
```

האימות כולל תוצאות טבעיות, פרס יחיד, שני שידורים חוזרים לכל תוצאה, חיובי כניסה ויתרות, תקלות משימות רקע כולל משלוח אנליזה, ו־15 ניתוחים גמורים במסד האנליזה החדש. `1 passed` בדפדפנים לבדו אינו מעבר של ספי הביצועים או של אימות השרת.

## שחזור

```bash
python3 "$taskTools/rehearsal_integrations.py" restore --project "$taskProject" --rehearsal "$taskRehearsal"
```

השחזור מאמת את תוכנית הפעולה, עוצר את שירותי הבדיקה, מחזיר את ההגדרות והכלים הקודמים ומפעיל שוב את סביבת הבדיקה הקודמת. אין מחיקת מסדים או נפחים.
