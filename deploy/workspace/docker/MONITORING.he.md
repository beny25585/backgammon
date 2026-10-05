# לוגים של Docker בגרפאנה — Bot1

המשתמש אישר שהלוגים הגיעו לגרפאנה לפני המעבר. Alloy פועל כ־root דרך
`/opt/alloy/alloy-linux-amd64 run /etc/alloy-config.hcl`. האיסוף הקיים הוא
מקבצים ומ־journald, וכולם מועברים ל־`loki.write.local.receiver`.

`alloy.backgammon-docker.hcl` הוא תוספת לקובץ הקיים. הוא לא מחליף את Alloy,
Loki, Grafana, מקורות הלוגים האחרים או הדשבורדים. תוספת זו אוספת לוגים.
ל־CPU וזיכרון הוכן Prometheus נפרד ודשבורד חדש, לפי
[METRICS.he.md](METRICS.he.md). אפשר להכין candidate משולב עם
`prepare_alloy.py --include-metrics`; המדדים החדשים עדיין דורשים הפעלה
ואימות בשרת.

ב־2026-10-05 בוצעה בדיקת API לקריאה בלבד: Grafana החזירה health תקין,
ושאילתת Loki לחלון של עשר דקות החזירה רשומות של `job="backgammon"`.
זה מאמת קליטה קיימת באותו חלון, ואינו מאמת את תוספת Docker שטרם הופעלה.

## מה נאסף ואיך נשמרת התאימות

גילוי הקונטיינרים מוגבל לתווית Compose `backgammon-production`. שם הפרויקט
מוגדר ב־`compose.production.yaml`; אין לשנות אותו עם `-p` בלי להתאים את המסנן.
Docker המקומי ויישומי השרת האחרים אינם נאספים באמצעות התוספת.

| שירות | job |
| --- | --- |
| game-api, game-tasks, game-migrate | backgammon |
| tournaments-api, tournaments-tasks, push-worker, tournaments-migrate, tournaments-transfer | backgammon_tournaments_backend |
| analysis-api, analysis-worker, analysis-migrate | backgammon_analysis |
| dice | backgammon_dice |
| postgres | backgammon_postgres |
| redis | backgammon_redis |
| שלושת האתרים | backgammon_frontend |

כל רשומה מקבלת גם `source="docker"`, `stack="backgammon-production"`,
`service`, `container` ו־`component`. שמות ה־job הוותיקים של שרתי היישום
נשמרים. סינונים של דשבורדים לפי שמות יחידות systemd או נתיבי קבצים דורשים
סקירה: שמירת job לבדה אינה הוכחה שכל הפאנלים נשארו תואמים.

הגילוי מתרענן כל 15 שניות. זהו גילוי קונטיינרים, לא המתנה של 15 שניות לכל
רשומה: לאחר החיבור הלוגים מוזרמים. המקור מטפל בכפילויות של אותו container ID
שנוצרות עקב כמה רשתות/פורטים. אין להוסיף במקביל איסוף קבצי Docker לאותם
קונטיינרים. נשארת רוטציית Docker `local` של 3 קבצים בגודל 10 MB לכל קונטיינר.

שרתי Daphne מופעלים עם `--access-log -`; Gunicorn עם access/error ל־stdout/
stderr. הגדרות Django בדוקר מפנות גם שגיאות בקשה ולוגים של עובדים למסוף
כש־DEBUG=False. יש לבנות מחדש את תמונות השרתים אחרי שינוי ההגדרות.

## הכנה בשרת — בלי שינוי בתצורה הפעילה

בצע אחרי התקנת Docker, כשהסביבה לבדיקה פועלת. החלף `/path/to/project`
בנתיב חבילת הפריסה. אין להפעיל שני Alloy collectors לאותה תוספת.

```bash
/opt/alloy/alloy-linux-amd64 --version
sudo test -S /var/run/docker.sock
sudo /opt/alloy/alloy-linux-amd64 validate /etc/alloy-config.hcl

sudo python3 /path/to/project/docker/prepare_alloy.py \
  --output /etc/alloy-config.hcl.backgammon-candidate

sudo /opt/alloy/alloy-linux-amd64 validate \
  /etc/alloy-config.hcl.backgammon-candidate
```

הכלי יוצר קובץ חדש ב־0600, שומר את המקור ואת יעד Loki, ומסרב להוסיף את
התוספת פעמיים או לדרוס קובץ. אין שינוי בשירות הפעיל. אם `validate` חסר
בגרסה המותקנת או נכשל, עצור כאן ושלח diagnostics ללא סודות; אל תעדכן Alloy
או תחליף את התצורה אוטומטית. אימות התוספות המקומי עם Alloy 1.17.0 אינו מחליף אימות
עם הגרסה שמותקנת בשרת. אין לפתוח Docker TCP socket: משתמשים ב־Unix socket
שנגיש ל־Alloy שכבר פועל כ־root.

## החלה לאחר סקירת הקובץ ואימות מוצלח

הפקודות הבאות משנות את Alloy, ולכן מריצים אותן בשלב הפריסה המוסכם בלבד.
שמור את הערך של ALLOY_BACKUP לצורך חזרה. הגיבוי עשוי לכלול סודות, והוא פרטי.

```bash
ALLOY_BACKUP="/etc/alloy-config.hcl.before-backgammon-docker-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -m 0600 /etc/alloy-config.hcl "$ALLOY_BACKUP"
sudo install -m 0600 /etc/alloy-config.hcl.backgammon-candidate /etc/alloy-config.hcl
sudo systemctl restart alloy.service
systemctl status alloy.service --no-pager -l
sudo journalctl -u alloy.service --since '5 minutes ago' --no-pager
```

אין לשנות את `ExecStart`, את ספריית positions/storage או את endpoint של Loki.
המקורות הישנים נשארים בתקופת המעבר; הם משרתים גם את אפשרות החזרה. עצירת
יחידות Backgammon הישנות נעשית בנפרד, לפי מדריך הפריסה. לא מוחקים קבצי לוג
או מקורות של יישומים אחרים.

## הוכחה שהלוגים החדשים מגיעים

בחר את מקור הנתונים הקיים של Loki ב־Grafana Explore, חלון זמן אחרונות
15 דקות, ושאילתה:

```logql
{stack="backgammon-production", source="docker"}
```

הפעל Live tail. הרץ בשרת שלוש בקשות GET ל־health עם מזהה ייחודי. כאן אלה
פורטי התרגול; אחרי ההחלפה משתמשים ב־8005/8006/8007:

```bash
MONITOR_MARKER="monitor-$(date -u +%Y%m%dT%H%M%SZ)"
printf '%s\n' "$MONITOR_MARKER"
curl --fail --silent --show-error "http://127.0.0.1:18005/api/health/?monitor=$MONITOR_MARKER"
curl --fail --silent --show-error "http://127.0.0.1:18006/api/health/?monitor=$MONITOR_MARKER"
curl --fail --silent --show-error "http://127.0.0.1:18007/api/v1/health/?monitor=$MONITOR_MARKER"
```

חפש את המזהה שהודפס ב־Live tail. שאילתה לדוגמה, לאחר החלפת המזהה:

```logql
{stack="backgammon-production", service=~"game-api|tournaments-api|analysis-api"} |= "monitor-REPLACE_WITH_PRINTED_ID"
```

דרוש רשומת access חדשה אחת מכל API, עם job נכון. השווה ל־`dc logs --since
5m game-api tournaments-api analysis-api`. רק HTTP 200 או Alloy active אינם
מוכיחים קליטה. stdout של `docker exec echo` אינו לוג התהליך הראשי ולכן אינו
בדיקת קליטה תקפה.

לעובדים, השווה שורת פעילות חדשה אמיתית ב־`dc logs --since 10m game-tasks
push-worker analysis-worker` לאותה שורה וזמן בגרפאנה. בדיקת ניתוח רגיל מוכיחה
גם פעילות של analysis-worker. התראות נבדקות כחלק מבדיקת Push המוסכמת; אין
לשלוח התראת בדיקה למשתמש אמיתי בלי אישור. אם עובד שקט, מצב running אינו
הוכחת קליטת לוגים ממנו. `tournaments-tasks` נשאר מושבת עד סגירת האירוע
ואישור נפרד; אין להפעילו רק כדי לייצר לוג.

סנן לכל שירות לפי `service`, וודא שאין אותה רשומה פעמיים מאיסופים שונים,
ש־job הקיים עדיין עובד בפאנלים, ושאין שגיאות push/read/permission ביומן
Alloy. בחלון זמן קצר ייתכנו גם לוגי האתחול/ההיסטוריה של הקונטיינר; המזהה
הייחודי מבדיל אותם מהבקשה החדשה.

## חזרה אם איסוף הלוגים נפגע

אם הגרסה החדשה של Alloy/configuration נכשלת, שחזר את הגיבוי שיצרת:

```bash
sudo /opt/alloy/alloy-linux-amd64 validate "$ALLOY_BACKUP"
sudo install -m 0600 "$ALLOY_BACKUP" /etc/alloy-config.hcl
sudo systemctl restart alloy.service
systemctl status alloy.service --no-pager -l
```

זו חזרה של תצורת האיסוף בלבד, ללא עצירת יישומים או שינוי מסדי נתונים.

התיעוד שעליו מבוססת התוספת:
[Docker discovery](https://grafana.com/docs/alloy/latest/reference/components/discovery/discovery.docker/),
[Docker logs](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/),
[validation](https://grafana.com/docs/alloy/latest/reference/cli/validate/).
