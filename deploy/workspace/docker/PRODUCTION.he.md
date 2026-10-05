# הכנה ומעבר לפרודקשן — Bot1

שבע תמונות היישום נבנו ב־Bot1. תרגול העברת נתוני השרת עדיין בתהליך;
הייבוא לא הושלם ולא בוצע מעבר חי. tests ובניית האתרים נשארו למשתמש.
הפקודות להלן מיועדות לשלבי פריסה מוסכמים, לא להדבקה של המסמך כולו בשרת.
מצב המוכנות, פקודות ה־build/tests למשתמש ואימות התהליכים מופיעים ב־
[READINESS.he.md](READINESS.he.md). מדריך איסוף הלוגים הוא
[MONITORING.he.md](MONITORING.he.md).

## המצב שנבדק מול פלט השרת

Ubuntu 24.04, כ־8 GiB RAM, בלי swap, עם יישומים נוספים ומסד PostgreSQL
משותף ברמת המחשב. Nginx ו־Certbot נשארים במחשב, עם הדומיין
`38.247.146.17.nip.io`. לא מחליפים את תצורת האתרים האחרים.

| שירות | מקור הנתונים | יעד |
| --- | --- | --- |
| משחק, פורט 8005 | PostgreSQL 16.15, `backgammon_db` | שחזור ל־`backgammon_game` בדוקר |
| טורנירים, פורט 8006 | `/home/dev/backgammon-tournaments-backend/tournaments/db.sqlite3` | העברה ל־`backgammon_tournaments` |
| ניתוח, פורט 8007 | `/home/dev/backgammon-analysis-service/db.sqlite3` | מסד `backgammon_analysis` חדש, באישור המשתמש |

הגדרות הניתוח המקוריות נטענות דרך `PYTHONPATH=/etc/backgammon-analysis`
ו־`DJANGO_SETTINGS_MODULE=analysis_production`. אין צורך להעתיק את המודול
הזה לתמונה; כלי לכידת ההגדרות קורא את הערכים האפקטיביים דרך סביבת השירות.
הניתוחים הישנים ותור הניתוח לא מיובאים. קישורים לניתוחים ישנים יחזירו 404,
וספריית הניתוח תתחיל ריקה. נתוני המשחק והטורנירים נשמרים. משלוחים שהושלמו
בתור המשחק אינם נשלחים מחדש אוטומטית; ייבוא מחדש לניתוח יהיה פעולה נפרדת.

`backgammon-tasks.timer` מפעיל `run_tasks` חמש שניות אחרי סיום ההרצה, ויש
גם cron בכל דקה לאותה פקודה. עוברים לעובד Docker אחד. משימות הטורנירים
חסומות כעת באמצעות `ConditionPathExists=/run/t32-allow-tournament-tasks`.
הפרופיל `tournament-workers` נפרד ולא מופעל אוטומטית. אין להסיר את ההשהיה
עד לסגירת האירוע ואישור חידוש המשימות. ה־cron של `shesh_besh_bot` נשאר בנפרד.

## 1. הכנת קוד ותצורה

הקוד והתשתית מגיעים דרך Git. התחל לפי [מדריך הכנת סביבת הפריסה](../README.he.md),
מתוך commit מדויק של מאגר המשחק המכיל את `deploy/workspace`. `release.json`
מקבע את גרסאות ארבעת מאגרי המקור. הסקריפט מכין תיקייה חדשה לצד המערכת הפעילה;
אין לשנות או להזיז את המאגרים הפעילים כדי להתאים ל־Dockerfiles.

המשתמש התקין Docker Engine 29.8.2, Compose 5.6.0 ו־Buildx 0.37.1 ב־Bot1,
ואימת הרצת hello-world. אין לעצור את PostgreSQL/Redis של המחשב: הם עשויים
לשרת יישומים אחרים.

ההכנה יוצרת `docker/production.env` מהדוגמה, עם `IMAGE_TAG` של הגרסה.
ברירת המחדל היא פורטי בדיקה 18005–18007, שלא מתנגשים בשירותים הפעילים.
האתרים משתמשים בתמונות סטטיות ב־18105/18106/18108. תצורה זו נפרדת לחלוטין
מ־Compose המקומי; אין לטעון אותה מעל `compose.local.yaml`.

מתיקיית הפרויקט, לאחר התקנת Docker, אפשר להגדיר פונקציה לפקודות הבאות:

```bash
dc() {
  sudo docker compose --env-file docker/production.env \
    -f docker/compose.production.yaml "$@"
}
```

זו הגדרת פונקציה בלבד. אין בה הפעלת שירותים. `docker compose config` אינו
בודק שהמסדים יובאו או שהיישום עובד. המשתמש בונה בשרת באמצעות builder ייעודי,
עם מגבלת ליבת CPU אחת ו־3 GiB RAM. שבע התמונות נבנות אחת אחרי השנייה:

```bash
bash docker/build_on_server.sh
```

אין צורך להעביר חבילת מקור או תמונות מהמחשב. הבנייה משתמשת בקוד שנמשך
מ־Git לתיקיית הפריסה. לקונטיינרי היישום מוגדר `pull_policy: never`: תג שלא
נבנה יגרום לכשל, ולא למשיכת תמונה אחרת. ודא שהתמונות תואמות Linux/x86_64;
מתקין Open Sage בוחר בבנייה ללא דרישת AVX2. הבנייה אינה מפעילה שירותים,
מיגרציות או העברת נתונים.

## 2. סודות: נשארים בשרת ולא נשלחים לצ'אט

שלושת שירותי המקור צריכים להיות פעילים בזמן לכידת הגדרותיהם. החלף את
`/path/to/project` בנתיב שבו נמצאים קובצי Docker שסקרנו:

```bash
sudo install -d -m 0700 -o administrator -g administrator /etc/backgammon-docker
python3 /path/to/project/docker/prepare_production.py passwords \
  --directory /etc/backgammon-docker

/home/dev/backgammon/backend/.venv/bin/python -B \
  /path/to/project/docker/capture_service_config.py game \
  --service backgammon.service --directory /etc/backgammon-docker

/home/dev/backgammon-tournaments-backend/venv/bin/python -B \
  /path/to/project/docker/capture_service_config.py tournaments \
  --service backgammon_tournaments_backend.service --directory /etc/backgammon-docker

/home/dev/backgammon-analysis-service/.venv/bin/python -B \
  /path/to/project/docker/capture_service_config.py analysis \
  --service backgammon-analysis.service --directory /etc/backgammon-docker

python3 /path/to/project/docker/prepare_production.py validate \
  --directory /etc/backgammon-docker
```

הרץ כ־administrator. הקבצים אינם נדרסים. הכלי שומר SECRET_KEY, מפתחות
GameLink, טוקן ניתוח, מפתחות Push והגדרות Google/דואר/תשלום רלוונטיות.
הוא אינו שומר את סיסמאות המסדים הישנים או את כתובות השירותים הישנות.
`validate` בודק התאמה בין סודות השירותים, בלי להדפיס ערכים. יש לבדוק גם
את הגדרות המדיניות האפקטיביות, לא רק את קיום הקבצים: הכלי אינו ממפה כל
override Python שרירותי שהיה בשרת. אל תשתמש בסודות Docker המקומי בפרודקשן.
תיקיית ההגדרות פרטית; קובצי הסודות עצמם קריאים לתהליכים שקיבלו mount נפרד.

## 3. גיבוי ותרגול העברה

קודם שמור עותק פרטי של תצורת Nginx, יחידות systemd וה־cron הרלוונטיים.
שמור גם גיבוי סודות ומדיה במקום מוגן נוסף. MEDIA_ROOT ריק בפלט אינו הוכחה
שאין קבצים: יש לאתר את האחסון האמיתי ולשמר אותו. גיבוי המסדים:

```bash
python3 /path/to/project/docker/backup_production.py \
  --directory /home/administrator/backgammon-backups/REPLACE_WITH_UNIQUE_BACKUP_ID
```

הכלי יוצר תיקייה חדשה בלבד, `game.dump`, שני snapshots של SQLite ו־checksums.
הוא משתמש ב־SQLite Backup API ולא בהעתקת קובץ חי. עותקים נפרדים אינם עסקה
אחת בין המשחק והטורנירים. לגיבוי הסופי נדרשת עצירת כל הכתיבות תחילה.

ייצוא טורנירים נעשה מה־snapshot בעזרת הקוד וה־venv המקוריים. EXPORT_PATH
חייב להיות נתיב חדש ומוחלט. לא משתמשים במסד SQLite החי כמקור הייצוא:

```bash
sudo /home/dev/backgammon-tournaments-backend/venv/bin/python -B \
  /path/to/project/docker/tournaments_transfer.py export \
  --service backgammon_tournaments_backend.service \
  --sqlite /ABSOLUTE_BACKUP_PATH/tournaments.sqlite3 \
  --directory /ABSOLUTE_EXPORT_PATH
```

הייצוא כולל את כל הרשומות והמזהים, לרבות permissions, content types,
יחסי many-to-many, שחקנים פולימורפיים, sessions, ארנקים ותורים. אין לשתף
fixture או קובץ SQLite בצ'אט. הרשאות ברירת המחדל של החבילה הן 0700/0600.
פורמט ההעברה הוא 2: תאריכים נשמרים ב־UTC עם מלוא דיוק המיקרו־שניות,
והאימות משווה את הזמן בפועל. למשל, `.000Z` ו־`Z` מייצגים אותו זמן;
הבדל אמיתי של מיקרו־שנייה עדיין מכשיל את האימות. חבילה ישנה בפורמט 1
מחייבת ייצוא מחדש מה־snapshot המקורי לתיקייה חדשה, מפני שהייצוא הישן
קיצר את דיוק התאריכים. אין לשנות ידנית את ה־manifest או את ה־fixture.
שירות `tournaments-transfer` טוען את הכלי מקובץ Git ב־mount לקריאה בלבד,
כך שאפשר להשתמש בתמונות היישום שכבר נבנו. יש להשתמש בסביבת פריסה חדשה
ומאומתת עם כלי ההעברה המתוקן; אין להחליף קבצים מאחורי רשימת ה־hashes.
העתק את חבילת הייצוא לתיקיית `TRANSFER_DIR`, כ־`tournaments/`, והקצה לבעלים
10001:10001 כדי שהמשתמש הלא־מנהל בקונטיינר יוכל לקרוא אותה. זו תיקיית העברה
ייעודית; לא משנים בעלות על תיקיות הקוד או מסדי המקור.

לאחר הכנת הקבצים והסודות, הפעל רק תשתית:

```bash
dc up -d --wait --no-build postgres redis dice
```

מסד המשחק חייב להיות ריק לפני השחזור. הזרמת הגיבוי אליו:

```bash
dc exec -T postgres sh -c \
  'export PGPASSWORD="$(cat /run/secrets/game_password)"; exec pg_restore --single-transaction --exit-on-error --no-owner --no-acl -h 127.0.0.1 -U backgammon_game -d backgammon_game' \
  < /ABSOLUTE_BACKUP_PATH/game.dump
```

לאחר השחזור, החל מיגרציות. בניתוח מדובר במסד חדש; אין לייבא את SQLite שלו:

```bash
dc run -T --interactive=false --rm game-migrate < /dev/null
dc run -T --interactive=false --rm tournaments-migrate < /dev/null
dc run -T --interactive=false --rm analysis-migrate < /dev/null
dc run -T --interactive=false --rm tournaments-transfer python /opt/docker/tournaments_transfer.py \
  import --directory /transfer/tournaments \
  --confirm-new-database backgammon_tournaments < /dev/null
```

הייבוא מסרב למסד עם משתמשים, משחקים, sessions או עסקאות קיימים. רק הרשומות
הראשוניות הידועות מהמיגרציות מותרות: metadata, משימת התפוגה במצב ראשוני
וקטלוג ארבע דרגות החברות כאשר כל ערכיו עדיין זהים למיגרציה.
בתוך טרנזקציה אחת הוא נועל את הטבלאות,
מחליף את הרשומות הראשוניות בייצוא, בודק hashes, ספירות, מזהים, קשרים וערכים
כספיים, ובודק constraints. כשל מבטל את הייבוא כולו. `loaddata` מעדכן sequences.
לאחר הייבוא נוצרים metadata ו־permissions שחסרים למודלים חדשים בגרסת היעד.
מזהי הרשומות שיובאו נשמרים; האימות מאפשר תוספות metadata אלה, אך עדיין
דורש התאמה מלאה של הרשומות העסקיות ושל כל רשומות ה־metadata מהמקור.
אין להשתמש ב־`--fake` או למחוק מיגרציות. אם קוד המקור והיעד שונים, יש לתרגל
את התאימות והמיגרציות על עותק לפני המעבר; checksums אינם הוכחה לתקינות עסקית.

תרגול מקומי מבודד עם נתונים מלאכותיים מתועד ב־
[TRANSFER-REHEARSAL.he.md](TRANSFER-REHEARSAL.he.md). הוא עבר גם עם מודל
טורניר פולימורפי; הייצוא שומר בנפרד את רשומות האב והבן. זה אינו מחליף
תרגול עם עותק נתוני השרת והמיגרציות האמיתיות שלו.

תהליך השחזור הזה חד־פעמי למסד יעד חדש. לתרגול חוזר משתמשים בפרויקט Docker
ובתיקיות חדשים ומבודדים, ולא מוחקים volume שמשמש אתר פעיל. אין להריץ עובדים
או בקשות יצירת משחק על עותק שה־PUBLIC_ORIGIN שלו מצביע לפרודקשן: callbacks
עלולים להגיע לשירותים הישנים. בדיקות משחק מלא מבצעים עם origin מבודד.

## 4. בדיקות לפני פתיחה

כל שרת API מסרב לעלות כשיש מיגרציות חסרות. הפעל APIs ואתרים בלבד, אחרי
ייבוא ובדיקת הנתונים, והרץ את בדיקות הפריסה והמיגרציות לכל שירות:

```bash
dc --profile live up -d --wait --no-build
dc run --rm --no-deps game-api python manage.py check --deploy
dc run --rm --no-deps tournaments-api python manage.py check --deploy
dc run --rm --no-deps analysis-api python manage.py check --deploy
dc run -T --interactive=false --rm tournaments-transfer python /opt/docker/tournaments_transfer.py \
  verify --directory /transfer/tournaments < /dev/null
```

יש לבדוק ולפתור אזהרות בהתאם למצב האמיתי. HTTPS מסתיים ב־Nginx הקיים;
ה־APIs מאזינים רק על loopback וברשת Docker. הפניית HTTP ל־HTTPS נשארת
ב־Nginx, ולכן אין הפניה אוטומטית של הקריאות הפנימיות ל־HTTPS בקונטיינרים.
cookies ציבוריים מאובטחים ו־DEBUG כבוי. בדיקת health אינה בדיקת עומס,
חיובים, callbacks, login, Google, Push, מובייל או WebSocket. את אלה יש
לאמת לפני פתיחה לציבור. מסד המשחק דורש השוואת ספירות ומצב משחקים מול הגיבוי
לאחר השחזור, בנפרד מכלי אימות הטורנירים.

## 5. חלון תחזוקה והחלפת השירותים

יש לתאם חלון תחזוקה, לסיים משחקים פעילים, לחסום כניסות/כתיבות חדשות ולהסדיר
callbacks של תשלומים שבדרך. בזמן התחזוקה מפסיקים את המקורות הישנים לפני
הגיבוי הסופי. רשימת המעבר היא Backgammon בלבד: APIs המשחק/טורנירים/ניתוח,
עובדי הניתוח ו־Push, שירות הקוביות, שני טיימרי המשימות ויחידות המשימות.
יש להסיר רק את שורת המשחק מ־crontab של administrator ואת הפעלת הטורנירים
מ־`/etc/cron.d/backgammon-tournaments-tasks`. לא משנים את ה־cron של הבוט
הישן או תזמונים של אתרים אחרים. שמור את התצורות לפני עריכה. אין להסיר
את `incident-pause.conf` כדרך לעקוף את ההשהיה.

קח גיבוי סופי לאחר עצירת הכתיבות, וייבא אותו למסדי יעד חדשים. עותק התרגול
אינו העותק הסופי. שנה `GAME_API_PORT=8005`, `TOURNAMENTS_API_PORT=8006`,
`ANALYSIS_API_PORT=8007` רק אחרי שחרור הפורטים מהשירותים הישנים. APIs הקיימים
ב־Nginx יפנו אז לקונטיינרים באותם פורטים. החלף רק את ארבעת בלוקי frontend/
static של בקגמון בבלוקים שב־`nginx.production.locations.conf`, והוסף את שני
מסלולי ה־static/media הייעודיים. לא מוסיפים `/static/` גלובלי שיכול לדרוס
את האתרים האחרים. קובץ זה הוא דוגמת החלפה בתוך server ה־HTTPS, לא קובץ
שמחליף את `calander_assist`. בדוק `nginx -t` לפני reload.

אחרי שהשירותים הישנים וה־cron אינם פעילים והחיבורים תקינים, הפעל את העובדים:

```bash
dc --profile live --profile workers up -d --wait --no-build
```

רק לאחר סגירת השהיית הטורנירים ואישור מפורש לחידוש הפעולות:

```bash
dc --profile live --profile workers --profile tournament-workers up -d --wait --no-build
```

הגבלות הזיכרון הן התחלה למחשב משותף של 8 GiB, לא הבטחת עומס. יש למדוד
צריכה/latency/תורים תחת משחק אמיתי, ולמנוע הרצת שתי סביבות מלאות עם עובדים
במקביל. stdout של הקונטיינרים משתמש ברוטציית לוגים. תוספת האיסוף והפקודות
להכנת candidate, אימות, גיבוי, החלה והוכחת Live tail מופיעות ב־
[MONITORING.he.md](MONITORING.he.md). בצע את התאמת Alloy ואימות הלוגים לפני
פתיחה לציבור. הלוגים הישנים הגיעו לגרפאנה בפועל לפי המשתמש; הקליטה החדשה
מדוקר עדיין דורשת הוכחה בשרת. הוכן גם Prometheus נפרד ומדריך אימות CPU
וזיכרון ב־[METRICS.he.md](METRICS.he.md). הפעלת הניטור היא עם פרופיל
`monitoring`; היא אינה מפעילה אוטומטית יישומים או עובדים נוספים.

## 6. חזרה במקרה של תקלה

לפני שנכתבו נתונים חדשים בדוקר, אפשר לעצור את קונטיינרי היישום, לשחזר את
בלוקי Nginx ולהחזיר את שירותי המקור ואת תזמוניהם המדויקים מהגיבוי. משימות
הטורנירים נשארות במצב ההשהיה המקורי. לא מפעילים שני סטים של עובדים.

לאחר פתיחת כתיבות בדוקר, חזרה למסדים הישנים תשמיט עסקאות ומשחקים חדשים.
במצב הזה עוצרים כתיבות ושומרים את המסדים החדשים, ומכינים העברת שינויים או
תיקון קדימה. אין לבצע חזרה אוטומטית מגיבוי ישן. אין להשתמש ב־`down -v`,
`volume prune`, מחיקת SQLite או עצירת PostgreSQL/Redis המשותפים כשלב cleanup.
