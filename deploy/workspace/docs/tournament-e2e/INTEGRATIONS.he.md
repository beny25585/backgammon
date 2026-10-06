# בדיקת כל שירותי האפליקציה לפני מעבר לפרודקשן

הכלים מיועדים רק לפרויקט Docker הקיים `backgammon-rehearsal-20261005t184922z`, לכתובת הבדיקה ב־18443 ולנתיבים שנבדקו. האתר הרגיל ב־443 עדיין דורש מעבר נפרד.

## 1. תמונת מצב מהשרת

`server_inventory.py` קורא את הקונטיינרים והתמונות, גרסאות המקור, זהות המאזין וכלי הבדיקה, שמות מסדי PostgreSQL, משאבי השרת, שירותי systemd ונתיבי Nginx. הגדרות פרטיות מוצגות רק כסטטוס הגדרה. סיסמאות, מפתחות ופקודות שירות מלאות אינם נכללים בדוח.

```bash
taskProject=/home/administrator/backgammon-deploy/bg-20261005-git-r2
taskRehearsal=/home/administrator/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal
taskTools=/path/to/pinned/Backgammon-Game/deploy/workspace/docs/tournament-e2e
taskInventory="$HOME/backgammon-server-inventory-$(date -u +%Y%m%dT%H%M%SZ).json"
sudo -v
python3 "$taskTools/server_inventory.py" --project "$taskProject" --rehearsal "$taskRehearsal" --output "$taskInventory"
```

יש לבדוק את הדוח לפני ההפעלה: זמינות משאבים, התאמת התמונות לזהות הבדיקה והימצאות `GOOGLE_CLIENT_ID` בהגדרה שנשמרה בשרת. תיקיית הבנייה המקורית עשויה להיות בגרסה הקודמת של הטורנירים; תמונת השירות נבנתה בנפרד מהתיקון `4cae430`. הדוח מציג את שני הדברים במפורש.

## 2. בדיקות הכלים והפעלה

המשתמש מריץ את הבדיקות. אלה בדיקות מבודדות של כלי ההפעלה; הן אינן מפעילות Docker או פונות למסדי נתונים או לספקי תשלום.

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

יש להעתיק את כל קובצי הכלים מה־commit המדויק לתיקיית בדיקה חדשה מקומית, למשל `docs/tournament-e2e-integrations`. אין לשנות את תיקיית ההרצה הקודמת. לאחר ההפעלה מורידים שוב את `browser-e2e-r2/server-client.json` ומריצים:

```powershell
.\docs\tournament-e2e-integrations\run-remote-tournament-e2e.ps1 -ServerManifest $taskManifest -Players 16 -Headed
```

ההרצה גובה 100 קוינס מכל שחקן, מאמתת 16 חיובים וסך 1,600 קוינס, חוזרת על ההרשמה כדי לבדוק שלא נוסף חיוב, ומשווה את כל היתרות אחרי חלוקת פרס קבוע של 100 קוינס. בונוס ההרשמה הרגיל מממן את הכניסה. זו בדיקת הארנק הפנימי; אין בה עסקת Tranzila.

בנוסף ל־15 משחקים אמיתיים, ההרצה ממתינה עד 45 דקות לסיום כל 15 הניתוחים עם Open Sage, קוראת פירוט ניתוח דרך הגשר המאומת, בודקת הגדרת Google ואתגר הכניסה, ומאמתת הגדרת Push ופעימת עובד ללא תקלות. ספי הביצועים המקוריים נשארים בתוקף. HTTP cache ו־service workers נשארים במצב בדיקת הביצועים המקורית.

הרצת הדפדפנים אינה מוכיחה כניסה אמיתית דרך Google או מסירת Push למכשיר. יש לבצע אותן ידנית בחשבון בדיקה בסביבה החדשה ולבדוק את תוצאות השרת.

## 4. אימות במסדים

לאחר העלאת `tournament-summary.json`:

```bash
python3 "$taskTools/server_rehearsal.py" audit --project "$taskProject" --rehearsal "$taskRehearsal" --summary "$HOME/e2e-tournament-summary.json"
```

האימות כולל תוצאות טבעיות, פרס יחיד, שני שידורים חוזרים לכל תוצאה, חיובי כניסה ויתרות, תקלות משימות רקע כולל משלוח אנליזה, ו־15 ניתוחים גמורים במסד האנליזה החדש. `1 passed` בדפדפנים לבדו אינו מעבר של ספי הביצועים או של אימות השרת.

## שחזור

```bash
python3 "$taskTools/rehearsal_integrations.py" restore --project "$taskProject" --rehearsal "$taskRehearsal"
```

השחזור מאמת את תוכנית הפעולה, עוצר את שירותי הבדיקה, מחזיר את ההגדרות והכלים הקודמים ומפעיל שוב את סביבת הבדיקה הקודמת. אין מחיקת מסדים או נפחים.
