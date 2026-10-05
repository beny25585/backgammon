# בדיקת 16/32 שחקנים דרך Nginx בשרת

הכניסה היא `https://38.247.146.17.nip.io:18443/tournaments/` בתוך תהליך Nginx הקיים.
היא משתמשת בתעודה הקיימת ובאותם נתיבי HTTP ו־WebSocket. פורט 443 והאתרים הפעילים
אינם מוחלפים. הקובץ `/etc/nginx/backgammon-rehearsal-e2e.preview.conf` שנשמר ידנית
הוא תצוגה להכנה בלבד; כלי ההפעלה מתקין את התצורה המלאה ב־`conf.d`.

משתמשים בתמונות R2 שכבר נבנו ובמסדים שהועתקו אל
`backgammon-rehearsal-20261005t184922z`. אין מחיקה או יצירה מחדש של PostgreSQL/Redis.
הכלי בודק את מזהי התמונות, שומר את הרשת הפנימית, ומריץ migrations רק בהעתק.
שני העובדים הרגילים רצים פעם ב־5 שניות, במנות של 50, עובד אחד לכל שירות.
תזמון העובדים אינו קצב הפעולות של השחקנים: השחקנים ממתינים לאישור פעולה אמיתי.

הדפדפנים רצים במחשב המשתמש; השרת מפעיל את האפליקציות בלבד. אין זמני קצוב נוספים
למשחק. סף הביצועים נשאר: ממוצע ACK לכל סיבוב עד שנייה, ACK יחיד עד 5 שניות,
כניסה למשחק ואישור תוצאה עד 15 שניות. צילום ההתקדמות משותף לכל הממתינים ובקצב
מרבי של GET אחד בשנייה. אין הזרקה של תוצאה, לוח, ניקוד או מנצח.

## בשרת

משוך את commit כלי הבדיקה שסופק בצ׳אט אל תיקיית bootstrap חדשה, דרך SSH של GitHub.
אל תערוך את הפריסה המוכנה `bg-20261005-git-r2`; קובצי הפריסה שלה נבדקים לפי hash.

```bash
project_dir="$HOME/backgammon-deploy/bg-20261005-git-r2"
rehearsal_dir="$HOME/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal"
# הגדר tools_dir לפי תיקיית bootstrap שנמשכה בפקודות בצ׳אט.
e2e() {
  python3 "$tools_dir/server_rehearsal.py" "$@" \
    --project "$project_dir" --rehearsal "$rehearsal_dir"
}
e2e prepare
e2e start
e2e check
e2e monitoring
e2e baseline
```

`prepare` בונה רק את מנוע המהלכים הטהור שמייבא מנהל הבדיקה, באמצעות המקור והנעילה
של R2 ובונה מוגבל ל־CPU אחד ו־3GiB. תמונות האפליקציה אינן נבנות מחדש. אם בניית
המנוע נעצרה לאחר יצירת התצורה הפרטית, אפשר להשלים עם `e2e finish-prepare`.

`start` מחיל migrations ו־collectstatic בהעתק, יוצר מנהל חדש לבדיקות, שומר baseline
פרטי למשימות, ממתין לתקינות ה־API והממשקים, מתקין קובץ Nginx חדש ומבצע reload.
נבדקות קריאות HTTPS מתוך שני הקונטיינרים בחזרה לכניסת הבדיקה לפני הפעלת העובדים.
המפתחות לבדיקות חדשים; אין שליחת תשלומים, דואר, push או ניתוחים לשירות חיצוני.

אם פורט 18443 חסום, בדוק את חומת האש לפני שינוי: `sudo ufw status numbered`.
אין צורך לשנות DNS או את תעודת TLS. אין צורך בטנל SSH כדי להשתמש בכניסה הציבורית.

## ניטור

`monitoring` שומר גיבוי פרטי של Alloy, מוסיף איסוף לוגים רק לפרויקט התרגול,
ומעביר את המדדים שלו לאותו Prometheus קיים. האספנים של שאר השירותים נשמרים.
הכלי מריץ `alloy validate` לפני restart; שגיאת הפעלה מחזירה את הגיבוי.

בדוק בגרפאנה נתונים חדשים עם:

```text
{stack="backgammon-rehearsal-20261005t184922z"}
container_memory_working_set_bytes{stack="backgammon-rehearsal-20261005t184922z"}
rate(container_cpu_usage_seconds_total{stack="backgammon-rehearsal-20261005t184922z"}[1m])
```

הצלחת אימות התצורה אינה הוכחה שהנתונים הגיעו; צריך לראות חותמות זמן חדשות.

## במחשב שלך

העתק את manifest המנהל החדש לתיקייה מקומית פרטית. אל תשלח את תוכנו לצ׳אט.
קובץ זה אינו מכיל סיסמאות למסדי הנתונים או מפתחות חתימה בין השירותים.

```powershell
$taskPrivateDir = Join-Path (Get-Location) 'docs\tournament-e2e\runs\server-r2'
New-Item -ItemType Directory -Force -Path $taskPrivateDir | Out-Null
$taskAccount = (& whoami.exe).Trim()
& icacls.exe $taskPrivateDir /inheritance:r /grant:r "${taskAccount}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F'
scp administrator@38.247.146.17:/home/administrator/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal/browser-e2e-r2/server-client.json "$taskPrivateDir\server-client.json"

node --test .\docs\tournament-e2e\destination-policy.test.mjs .\docs\tournament-e2e\performance-policy.test.mjs
.\docs\tournament-e2e\run-remote-tournament-e2e.ps1 -ServerManifest "$taskPrivateDir\server-client.json" -Players 16
# לאחר האימות של הרצת 16, רענן baseline בשרת וחזור עם -Players 32.
```

לפני יצירת חשבונות נבדקים זיהוי סביבת Nginx, hash מנוע הבדיקה, גרסאות ארבעת
המקורות ו־hash של כלי הבדיקה במחשב ובשרת. צריך להשתמש בקבצים מה־commit שנשלח.
ההרצה מבצעת הרשמה, כניסה, רישום לטורניר וכניסה למשחק דרך הממשק האמיתי.

מגבלה: קישור החזרה מהמשחק לטורנירים בתמונת R2 נבנה לכתובת הפרודקשן בפורט 443.
הבדיקה מנווטת ישירות לכניסת הבדיקה וחוסמת יציאה ממנה; היא אינה בודקת את הקישור הזה.
ניתוחים, תשלומים, דואר ו־push מוחרגים. הבדיקה אינה בדיקת מובייל או מחוות גרירה.

## אימות מסדים לאחר כל הרצה

הדפדפן מדפיס `UPLOAD FOR SERVER AUDIT` עם קובץ `tournament-summary.json` ללא סודות.
העבר את הקובץ המתאים:

```powershell
scp '<הנתיב שנדפס>\tournament-summary.json' administrator@38.247.146.17:/home/administrator/e2e-tournament-summary.json
```

בשרת, עם אותה פונקציית `e2e`:

```bash
e2e audit --summary "$HOME/e2e-tournament-summary.json"
```

האימות מוגבל לטורניר ולמשתמשים של ההרצה. נבדקים כל המשחקים, נשיאה טבעית של
15 אבנים, חדרים ומושבים, תוצאות שנמסרו, התאמת מנצח וניקוד, פודיום ופרס יחיד.
לאחר מכן נשלחות פעמיים אותן תוצאות חתומות שכבר הסתיימו, ונבדק שוב שאין פרס כפול.
כשל חדש או שינוי בכשל של משימת רקע מכשיל את האימות; כשלים ישנים מדווחים לפי baseline.

קבלה מלאה דורשת גם ספי ביצועים שעברו במחשב וגם `SERVER DATABASE AND DUPLICATE-RESULT AUDIT PASSED`.
אין סימון אוטומטי של הצלחה מלאה לפני אימות המסדים בשרת.

לפני כל הרצת דפדפן חדשה מריצים `e2e baseline` בשרת. כך ה־baseline כולל כשלים
היסטוריים שכבר היו לפני העומס, והמשתמשים החדשים חייבים להיווצר אחריו.
אין לרענן baseline בזמן הרצה או לפני האימות שלה; פעולה כזו תכשיל את בדיקת שייכות המשתמשים.

## סיום הבדיקה

```bash
e2e stop
e2e monitoring-restore
```

נעצרות רק אפליקציות הבדיקה, וקובץ Nginx של הבדיקה מוסר לאחר בדיקת שייכות לסשן.
המסדים והגיבויים נשמרים. ניקוי הנתונים או מחיקת volumes הם שלב נפרד אחרי הבדיקות.
גיבוי Alloy נמצא ב־`browser-e2e-r2/alloy.before-rehearsal.hcl`; אין למחוק אותו לפני
סיום הניטור. כניסת הבדיקה אינה החלפת פרודקשן ואין להעתיק את מסד התרגול בחזרה לשרת הפעיל.
