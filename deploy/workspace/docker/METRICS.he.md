# CPU וזיכרון בגרפאנה — Bot1

הוכן Prometheus נפרד ל־Backgammon ודשבורד חדש. Alloy הקיים על השרת אוסף
מדדי CPU וזיכרון של השרת ושל קונטיינרי `backgammon-production`, ושולח אותם
ל־Prometheus ב־loopback. הגדרת Loki ואיסוף הלוגים הקיים נשמרים.
התצורה עברה אימות מקומי; איסוף מדדים אמיתי בשרת וייבוא הדשבורד טרם בוצעו.

## הרכיבים וההגבלות

- `prometheus` נמצא בפרופיל `monitoring`, עם פורט `127.0.0.1:19090`,
  רשת נפרדת, volume מתמיד, משתמש ללא root ומגבלת זיכרון 256 MiB.
- התמונה היא `prom/prometheus:v3.13.4`, גרסת LTS מפורשת. היא אינה אחת
  משבע תמונות היישום; יש למשוך או לטעון אותה בנפרד בשרת.
- נשמרים עד שבעה ימים. סף 512 MB מגביל את בלוקי המדדים; WAL וקבצים
  נלווים צורכים מקום נוסף. זה אינו גבול קשיח לכל ה־volume.
- האיסוף הוא כל 15 שניות. מדד CPU מבוסס על חלון של שתי דקות; הוא אינו
  קריאה מיידית לכל תנועת מעבד. בזמן אתחול נדרשות כמה דגימות.
- cAdvisor רץ בתוך Alloy הקיים, שכבר פועל כ־root בשרת Linux. הוא קורא
  את Docker socket המקומי. אין לפתוח socket ברשת או להוסיף קונטיינר privileged.
- לפני השמירה נותרות רק סדרות קונטיינרים של הפרויקט הזה. תוויות Compose
  project/service בלבד נשמרות לצורך הסינון, ללא תוויות Docker חופשיות.
  cAdvisor עצמו מגלה קונטיינרים דרך Docker; הסינון אינו בידוד של הרשאות הקריאה.
- מדדי השרת כולו כוללים גם את עבודת היישומים האחרים. כך אפשר להבחין
  בין לחץ על השרת לבין צריכת Backgammon. רכיבי הניטור הקיימים אינם מוחלפים.

## הפעלה בשלב הפריסה

השתמש בפונקציית `dc` מה־[מדריך הפריסה](PRODUCTION.he.md). בדוק שהפורט
19090 פנוי לפני ההפעלה. אם הוא תפוס, עצור והתאם יחד את Compose, כתובת
remote_write ב־Alloy וכתובת מקור הנתונים בגרפאנה; אין לעצור שירות זר.

```bash
sudo ss -ltnp 'sport = :19090'
dc --profile monitoring pull prometheus
dc --profile monitoring up -d --wait --no-build prometheus
curl --fail --silent --show-error http://127.0.0.1:19090/-/ready
```

צור candidate חדש של Alloy עם שתי התוספות. הכלי שומר את המקורות הקיימים;
אם תוספת הלוגים שלנו כבר קיימת הוא מוסיף רק את המדדים. הוא מסרב להוסיף
מדדים פעמיים או לדרוס קובץ קיים. החלף `/path/to/project` בנתיב הפריסה.

```bash
/opt/alloy/alloy-linux-amd64 --version
sudo /opt/alloy/alloy-linux-amd64 validate /etc/alloy-config.hcl
sudo python3 /path/to/project/docker/prepare_alloy.py \
  --include-metrics \
  --output /etc/alloy-config.hcl.backgammon-metrics-candidate
sudo /opt/alloy/alloy-linux-amd64 validate \
  /etc/alloy-config.hcl.backgammon-metrics-candidate
```

אם האימות נכשל, אין להחיל את הקובץ או לשדרג Alloy אוטומטית. האימות המקומי
בוצע עם Alloy 1.17.0, כפי שהותקן בשרת; עדיין יש לאמת את הקובץ המלא בבינארי
של השרת. אחרי סקירת candidate
ואימות מוצלח, גבה והחל בשלב הפריסה המוסכם:

```bash
ALLOY_BACKUP="/etc/alloy-config.hcl.before-backgammon-metrics-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -m 0600 /etc/alloy-config.hcl "$ALLOY_BACKUP"
sudo install -m 0600 /etc/alloy-config.hcl.backgammon-metrics-candidate /etc/alloy-config.hcl
sudo systemctl restart alloy.service
systemctl status alloy.service --no-pager -l
sudo journalctl -u alloy.service --since '5 minutes ago' --no-pager
```

אין לשנות את `ExecStart`, ספריית ה־storage/WAL/positions או יעד Loki.
שמור את הגיבוי הפרטי. חזרה לתצורה הקודמת מתבצעת לפי
[מדריך הלוגים](MONITORING.he.md), באמצעות ALLOY_BACKUP הנוכחי.
אפשר לעצור רק את `prometheus` החדש אם הוא אינו נחוץ; אין למחוק את ה־volume
או לעצור ניטור אחר כחלק מחזרה.

## מקור הנתונים והדשבורד

בגרפאנה הקיימת, הוסף מקור נתונים חדש מסוג Prometheus:

| הגדרה | ערך |
| --- | --- |
| Name | Backgammon Prometheus |
| URL | `http://127.0.0.1:19090` |
| Scrape interval | `15s` |
| Default | כבוי |

הכתובת מתאימה לגרפאנה שרצה על אותו host, כפי שנצפה במיפוי Bot1.
אם Grafana עצמה בקונטיינר, loopback יפנה לקונטיינר שלה וצריך כתובת פנימית
מתאימה; אין לפרסם את Prometheus לאינטרנט כדי לעקוף זאת. לחץ Save & test.
אל תשנה את מקור Loki או מקור Prometheus אחר שכבר קיים.

ב־Dashboards → New → Import, העלה `grafana.backgammon-resources.json` ובחר
את המקור החדש בשדה DS_PROMETHEUS. הדשבורד נוצר עם UID חדש
`backgammon-resources`; אם כבר קיים דשבורד בשם/UID הזה, סקור אותו לפני דריסה.
אין צורך להפעיל מחדש את Grafana כדי להוסיף מקור דרך הממשק.

הדשבורד מציג CPU וזיכרון של השרת, CPU לפי שירות ביחידות ליבות
(1.0 פירושו ליבה אחת מלאה), זיכרון לפי שירות, אחוז ממגבלת הזיכרון,
זמן פעולת קונטיינרים וגיל הדגימה. רענון הדשבורד הוא כל 15 שניות.
נתון חסר אינו מוצג כ־0. הוא דורש בדיקת קליטה או שירות שאינו פעיל.

## הוכחת קליטה חדשה

לאחר לפחות שתי דקות, הרץ שאילתות מקומיות:

```bash
curl --fail --silent --show-error --get \
  --data-urlencode 'query=node_memory_MemTotal_bytes{stack="backgammon-production"}' \
  http://127.0.0.1:19090/api/v1/query

curl --fail --silent --show-error --get \
  --data-urlencode 'query=count by(service)(container_memory_working_set_bytes{stack="backgammon-production"})' \
  http://127.0.0.1:19090/api/v1/query

curl --fail --silent --show-error --get \
  --data-urlencode 'query=max(time()-timestamp(container_memory_working_set_bytes{stack="backgammon-production"}))' \
  http://127.0.0.1:19090/api/v1/query
```

דרוש `status=success` עם תוצאות שאינן ריקות. שמות השירותים צריכים להתאים
לקונטיינרים שבאמת פועלים. `tournaments-tasks` נשאר מושבת בשרת עד אישור
חידוש נפרד, ולכן אינו נדרש ברשימה. גיל דגימה שגדל או נשאר מעל 60 שניות
מחייב בדיקת scrape/remote_write ביומן Alloy; health ירוק של Prometheus לבדו
אינו מוכיח שאיסוף הקונטיינרים עובד. תוויות Docker/cgroup תלויות בגרסאות
השרת, ויש לוודא שהמסנן מזהה את תוויות Compose בפועל.

השווה את צריכת הזיכרון ואת קצב ה־CPU בזמן משחק אמיתי גם מול
`docker stats --no-stream`. החלונות שונים ולכן אין לצפות למספר זהה בכל רגע.
לאחר שינוי Alloy בצע גם את הוכחת קליטת הלוגים החדשים ב־
[MONITORING.he.md](MONITORING.he.md), ובדוק שהלוגים הקיימים ממשיכים להגיע.

מקורות:
[Alloy cAdvisor](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.cadvisor/),
[Unix exporter](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.unix/),
[Prometheus datasource](https://grafana.com/docs/grafana/latest/datasources/prometheus/configure/),
[Dashboard import](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/import-dashboards/).
