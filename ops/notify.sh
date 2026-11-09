#!/usr/bin/env bash
# Send one alert to the owner's Hermes app.
#
#   ops/notify.sh <subject> <message>   send it, or queue it while Hermes is unreachable
#   ops/notify.sh --flush               send the queued alerts, waiting for Hermes as needed
#
# The Ember service account has no Hermes login. It posts the alert to the owner's Hermes
# webhook, which forwards it to the Hermes app as a push notification: the file
# ~/.config/ember/hermes-webhook (mode 0600) holds the route URL on its first line and the
# route's HMAC secret on its second. When Hermes cannot be reached (a gateway restart, for
# example), the alert waits in ~/.local/state/ember/alert-queue and ember-notify-retry.path
# starts `--flush`, which sends the queue in order, retrying every 30 seconds, and gives up on
# an alert after 24 hours. An alert Hermes refuses or does not deliver is not retried: notify
# fails and the caller logs it. Without the webhook file (an owner-run install) the alert goes
# through `hermes send` to the Hermes app. Neither the URL nor the secret ever appears on a
# command line, where other local users could read it.
set -Eeuo pipefail
usage() { echo "usage: $(basename "$0") <subject> <message> | --flush" >&2; }
export PATH=$HOME/.local/bin:$PATH
hermes_webhook=${EMBER_HERMES_WEBHOOK_FILE:-$HOME/.config/ember/hermes-webhook}
queue=${EMBER_ALERT_QUEUE:-$HOME/.local/state/ember/alert-queue}
if (($# == 1)) && [[ $1 == --flush ]]; then
	:
elif (($# == 2)); then
	[[ -e $hermes_webhook ]] || exec hermes send --quiet --to push --subject "$1" "$2"
else
	usage
	exit 2
fi
exec python3 -I - "$hermes_webhook" "$queue" "$@" <<'PY'
import fcntl, hashlib, hmac, json, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path

webhook, queue, args = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:]
RETRY_INTERVAL = float(os.environ.get('EMBER_ALERT_RETRY_INTERVAL', '30'))
MAX_AGE = float(os.environ.get('EMBER_ALERT_MAX_AGE', '86400'))


def log(text):
    print(f'notify: {text}', file=sys.stderr, flush=True)


def post(subject, message):
    """One signed attempt: 'delivered', 'retry' (Hermes unreachable) or 'failed', with a reason."""
    try:
        url, secret = (webhook.read_text().split('\n') + ['', ''])[:2]
    except OSError as error:
        return 'failed', f'cannot read {webhook}: {error}'
    if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{2,5}/webhooks/[a-z0-9-]+', url) or not secret:
        return 'failed', f'{webhook} does not hold a webhook URL and secret'
    body = json.dumps({'subject': subject, 'message': message[:1900]}).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), f'{timestamp}.'.encode() + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Signature-V2': signature})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            answer = response.read()
    except urllib.error.HTTPError as error:
        if error.code < 500 and error.code != 429:  # refused (signature, route): retrying cannot help
            return 'failed', f'Hermes webhook refused the alert: {error}'
        return 'retry', f'Hermes webhook failed: {error}'
    except Exception as error:
        return 'retry', f'Hermes webhook unreachable: {error}'
    # Hermes also answers 200 when its route drops an alert ("ignored"): only a delivery counts.
    try:
        if json.loads(answer).get('status') == 'delivered':
            return 'delivered', ''
    except (ValueError, AttributeError):
        pass
    return 'failed', f'Hermes did not deliver the alert: {answer[:200]!r}'


def queued():
    return sorted(queue.glob('*.json')) if queue.is_dir() else []


def enqueue(subject, message):
    queue.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = f'{time.time_ns():020d}-{os.getpid()}.json'
    # Written beside the queue and moved in whole, so the path unit never sees a partial file.
    staging = queue.parent / f'.{name}.tmp'
    fd = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump({'subject': subject, 'message': message, 'queued_at': time.time()}, file)
    os.replace(staging, queue / name)


def send(subject, message):
    if waiting := len(queued()):  # Hermes is known to be away: keep the order
        enqueue(subject, message)
        log(f'queued behind {waiting} undelivered alert(s)')
        return 0
    for attempt in range(3):
        status, reason = post(subject, message)
        if status != 'retry':
            break
        time.sleep(2)
    if status == 'delivered':
        log(f'sent: {subject} {message}')
        return 0
    if status == 'failed':
        log(reason)
        return 1
    enqueue(subject, message)
    log(f'{reason}; queued until Hermes takes it')
    return 0


def flush():
    queue.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(queue.parent / '.alert-queue.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        lost = 0
        while items := queued():
            for item in items:
                try:
                    alert = json.loads(item.read_text())
                    subject, message = str(alert['subject']), str(alert['message'])
                    queued_at = float(alert['queued_at'])
                except (OSError, ValueError, KeyError, TypeError) as error:
                    log(f'dropped unreadable queued alert {item.name}: {error}')
                    item.unlink(missing_ok=True)
                    lost += 1
                    continue
                if time.time() - queued_at > MAX_AGE:
                    log(f'gave up after {MAX_AGE / 3600:g} h, Hermes never took this alert: {subject} {message}')
                    item.unlink(missing_ok=True)
                    lost += 1
                    continue
                status, reason = post(subject, message)
                if status == 'retry':
                    break  # wait, then start again from the oldest
                if status == 'failed':
                    log(f'{reason}: {subject} {message}')
                    lost += 1
                else:
                    log(f'sent: {subject} {message}')
                item.unlink(missing_ok=True)
            else:
                continue
            time.sleep(RETRY_INTERVAL)
    # Failing makes the unit's OnFailure alert report the loss, once Hermes takes alerts again.
    return 1 if lost else 0


sys.exit(flush() if args == ['--flush'] else send(*args))
PY
