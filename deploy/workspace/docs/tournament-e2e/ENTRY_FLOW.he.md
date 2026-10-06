# מדידת מסלול הכניסה למשחק

כלי הבדיקה מתעד את המסלול לכל שחקן ומשחק. המדידות אינן משנות את
הרשאות הכניסה, הטרנזקציות, הנעילות, השעון או תנאי קבלת הביצועים.
תיעוד השרת נטען רק בשני שירותי API של סביבת התרגול, אחרי אימות מסדי
PostgreSQL הייעודיים, Redis, מזהה ההרצה וכתובת Nginx של הבדיקה.
תמונות היישומים והפקודות של העובדים נשארות כפי שהוגדרו להרצה.

| שלב | ראיה | שעון |
|---|---|---|
| המשחק זמין לשחקן | `Fixture.playable_at` השמור, ובמקרים שבהם השינוי נעשה ב־API גם callback אחרי commit | שרת |
| הזמינות הגיעה למסך | JSON אמיתי של רשימת הטורנירים או פרטי המשחק | דפדפן |
| כפתור הכניסה זמין | כפתור נראה ופעיל ב־DOM | דפדפן |
| השחקן לחץ | אירוע click של הכפתור שנלחץ בפועל | דפדפן |
| נשלחה הצטרפות | שליחת `entry_join` המקורית, עם אותו `attempt_id` | דפדפן |
| ההצטרפות הגיעה ליישום | קבלת הודעת ASGI, ואז תחילת טיפול ב־consumer | שרת |
| בדיקת המוכנות עובדה | זמן עד כניסה לפונקציה הסינכרונית, זמן ביצוע, מספר ומשך שאילתות | שרת |
| נוכחות אישית נשמרה | החזרה מהפעולה המקורית ב־Redis | שרת |
| שני השחקנים אושרו | callback אחרי commit של הרשאת הזוג | שרת |
| המוכנות נשלחה והתקבלה | שליחת `entry_state` והאירוע הראשון עם `both_ready=true` לכל ניסיון | שני דוחות נפרדים |
| התבקש כרטיס כניסה | fetch אמיתי, קבלת כותרות וקריאת JSON | דפדפן |
| בקשת הכרטיס והכניסה עובדו | כניסה ל־ASGI, תחילת middleware סינכרוני, פעולות פנימיות, שאילתות וסיום בקשה | שרת |
| מושב הושלם והחדר התחיל | callbacks אחרי commit של הפעולה המקורית | שרת |
| החיבור למשחק נפתח | יצירה ופתיחה של WebSocket, קבלת מצב ראשוני ושני שחקנים מחוברים | דפדפן |
| השרת אישר חיבור ושלח מצב | ASGI accept ושליחת המצב הראשוני | שרת |
| הלוח הופיע | מסגרת לוח נראית ב־DOM אחרי קבלת מצב ראשוני | דפדפן |

הדוח בדפדפן נמצא ב־`performance-summary.json`: החלק `entryFlowDiagnostics`
מתאר זמינות, לחיצה, מוכנות וכרטיס. החלק `admissionDiagnostics` ממשיך
מתוך הכניסה לניווט, טעינת היישום, WebSocket והלוח. דוח השרת
`entry-flow-<runId>.json` כולל שלבים, סיכומי זמן ומספרי שאילתות,
פעולות HTTP פנימיות וספירת בדיקות מוכנות חוזרות. בקשות הכרטיס והכניסה
מקבלות כותרת `X-E2E-Trace-ID` לצורך שיוך ביניהן לבין מדידות השרת.

ההמתנה במחסום הלחיצות של הבדיקה מופיעה בנפרד ב־`testBarrierMs`.
בסיבוב הראשון נשארים בדף שנפתח לפני ההפעלה, כדי לראות את עדכוני
הזמינות הרגילים. בהרצת recovery בלבד נשאר רענון הדף שנדרש להשהיית
החיבור המכוונת. בסיבובים הבאים הניווט הרגיל של כלי הבדיקה נשמר.
לכן ראיית הזמינות בסיבוב הראשון חזקה יותר מזו שנאספת לאחר ניווט מאוחר.

## מה אפשר להסיק

- `joinToPairReadyMs` ו־`individualPresenceToAuthorizationMs` כוללים המתנה
  ליריב. `lastPresenceToAuthorizationMs` מחושב רק אם נצפו שני מושבים שונים.
- `queueMs` של בדיקת מוכנות מודד עד הכניסה לפונקציה הסינכרונית. הוא
  כולל המתנה למבצע הסינכרוני והכנות חיבור שנעשו לפני הפונקציה.
- `asgiToSyncMiddlewareMs` כולל הכנת הבקשה והמתנה לעיבוד סינכרוני;
  זו אינה מדידה של תור אחד בלבד. `processingMs` ו־`asgiTotalMs` נפרדים.
- `lockStatementMs` הוא משך שאילתות הכוללות בקשת נעילה. הוא כולל ביצוע,
  רשת והמתנה למסד; אי אפשר להסיק ממנו לבדו כמה זמן נגרם מנעילה.
  מדידת השאילתות משתמשת ב־[Django execute_wrapper](https://docs.djangoproject.com/en/4.2/topics/db/instrumentation/).
- פעולות פנימיות מקוננות חופפות לסך הבקשה. אין לסכום אותן שוב.
  commit ו־callbacks יכולים להיכלל בזמן הביצוע בלי להיכלל בספירת שאילתות.
- נוכחות ב־Redis אינה commit של הרשאת כניסה. אם הפעולה נכשלת ומנוקה,
  אירוע הנוכחות לבדו אינו מוכיח שהשחקן אושר.
- חיבורי המשחק משויכים לחדר. הדוח אינו ממציא שיוך של חיבור שרת למושב
  אם לא נאספה ראיה לכך. זמני כל מושב בדפדפן משויכים לפי המשתמש והצבע.
- זמינות DOM אינה הוכחה לציור פיקסלים או להשלמת כל נכסי היישום.
- לא מפחיתים זמני שרת מזמני מחשב. מצמידים ראיות באמצעות מזהה משחק,
  ניסיון, מושב או trace. שלב חסר נשאר `null`; `coverage` מציין חסרים.

המדידות אינן שולחות בקשות מעקב חדשות בזמן הכניסה. הן מוסיפות עבודת
תצפית ולוגים, ולכן יש להן תקורה. בעת יצירת הדוח לאחר ההרצה מתבצעת
קריאה אחת של זמני הזמינות השמורים במסד התרגול. העובדים עצמם אינם
מנוטרים, ולכן commit של זמינות שביצעו יכול להישאר חסר בדוח.
לוגים שנמחקו בסבב רוטציה או ביצירת קונטיינר מחדש אינם משוחזרים.
כדאי להפיק את דוח השרת לפני עצירה או התחלה חדשה של סביבת התרגול.

## בדיקות להרצת המשתמש במחשב

מתיקיית הפרויקט:

```powershell
node --test .\docs\tournament-e2e\entry-flow.test.mjs .\docs\tournament-e2e\game-driver.test.mjs .\docs\tournament-e2e\admission-timing.test.mjs .\docs\tournament-e2e\performance-policy.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Browser measurement tests failed' }

Push-Location .\docs\tournament-e2e
try {
    & '..\..\backgammon-tournaments-backend\venv\Scripts\python.exe' -m unittest rehearsal_entry_test entry_flow_report_test rehearsal_observer_config_test rehearsal_context_test rehearsal_nginx_test
    if ($LASTEXITCODE -ne 0) { throw 'Server measurement tests failed' }
} finally { Pop-Location }
```

אלו בדיקות של כלי המדידה וההגנות עם דפדפן מדומה, קבצים זמניים ו־Docker
מדומה. הן אינן מוכיחות תקינות או ביצועים של הרצת שרת אמיתית.

## התקנה והרצה בשרת

לאחר העלאה מאושרת ל־Git ומשיכת אותה גרסה לשרת, עוצרים ומתחילים את
סביבת הבדיקה. הפעולה מנתקת משחקי בדיקה פעילים ויוצרת מחדש רק את שני
קונטיינרי ה־API כדי לטעון את המדידות. היא שומרת את מסדי התרגול ואת
תזמון העובדים. אין להריץ בזמן בדיקת שחקנים פעילה.

```bash
tools_dir="$HOME/backgammon-e2e-tools-20261006/deploy/workspace/docs/tournament-e2e"
bash "$tools_dir/server-rehearsal.sh" stop
bash "$tools_dir/server-rehearsal.sh" start
bash "$tools_dir/server-rehearsal.sh" check
```

מורידים שוב `server-client.json` למחשב, כי זהות כלי הבדיקה מתעדכנת.
הקבצים במחשב חייבים להיות מאותה גרסה, כולל העתקת כלי הבדיקה לתיקיית
`docs/tournament-e2e` אם עודכנו מתוך checkout של מאגר המשחק.
אחרי בדיקות היחידה מריצים כרגיל, במחשב:

```powershell
$taskManifest = Join-Path (Get-Location) 'docs\tournament-e2e\runs\server-r2\server-client.json'
scp administrator@38.247.146.17:/home/administrator/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal/browser-e2e-r2/server-client.json "$taskManifest"
if ($LASTEXITCODE -ne 0) { throw 'Manifest download failed' }
.\docs\tournament-e2e\run-remote-tournament-e2e.ps1 -ServerManifest "$taskManifest" -Players 16
```

מעלים לשרת את `tournament-summary.json` מההרצה החדשה, כפי שנעשה קודם.
לאחר מכן אפשר להפיק מדידות בלבד, בלי אישור עסקי ובלי replay של תוצאות:

```bash
bash "$tools_dir/server-rehearsal.sh" entry-report --summary "$HOME/e2e-tournament-summary.json"
```

גם `audit` מפיק את דוח המדידות לפני האימות העסקי המקורי. `entry-report`
יכול להפיק מידע חלקי מהרצה שנכשלה אחרי שנוצר טורניר; הוא אינו הופך
אותה להרצה שעברה. הדוח נשמר תחת `browser-e2e-r2/audit` והפקודה מציגה
את הנתיב המדויק. הוא אינו כולל SQL, אסימונים או גופי בקשות מתוך הלוגים.
