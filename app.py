import sys
import os
import io
import shutil
import sqlite3
import json
import random
import string
import webbrowser
import threading
from datetime import date, datetime
from flask import Flask, render_template, request, jsonify, send_file, Response


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


def get_db_path():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    db_dir = os.path.join(base, 'data')
    os.makedirs(db_dir, exist_ok=True)
    return os.path.join(db_dir, 'coupons.db')


app = Flask(__name__,
            template_folder=resource_path('templates'),
            static_folder=resource_path('static'))


def get_db():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL DEFAULT '',
            discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed')),
            discount_value REAL NOT NULL,
            expiry_date TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            used_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'used', 'expired')),
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    ''')
    for col in ['quantity', 'used_count', 'username']:
        try:
            conn.execute(f"ALTER TABLE coupons ADD COLUMN {col} " + {
                'quantity': "INTEGER NOT NULL DEFAULT 1",
                'used_count': "INTEGER NOT NULL DEFAULT 0",
                'username': "TEXT NOT NULL DEFAULT ''",
            }[col])
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()


def generate_code(prefix):
    digits = ''.join(random.choices(string.digits, k=3))
    letters = ''.join(random.choices(string.ascii_uppercase, k=3))
    random_part = digits + letters
    if prefix:
        return prefix + random_part
    return random_part


def compute_status(row):
    today = date.today().isoformat()
    if row['expiry_date'] < today:
        return 'expired'
    if row['used_count'] >= row['quantity']:
        return 'used'
    return 'active'


def auto_expire():
    today = date.today().isoformat()
    conn = get_db()
    conn.execute(
        "UPDATE coupons SET status='expired' WHERE expiry_date < ? AND status='active'",
        (today,)
    )
    conn.commit()
    conn.close()


def enrich_coupon(row):
    c = dict(row)
    c['computed_status'] = compute_status(row)
    return c


def validate_discount(discount_type, discount_value):
    if discount_type not in ('percentage', 'fixed'):
        return 'نوع تخفیف نامعتبر است'
    try:
        discount_value = float(discount_value)
    except (TypeError, ValueError):
        return 'مقدار تخفیف باید عدد باشد'
    if discount_value <= 0:
        return 'مقدار تخفیف باید مثبت باشد'
    if discount_type == 'percentage' and discount_value > 100:
        return 'درصد تخفیف نمی‌تواند بیش از ۱۰۰ باشد'
    return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/stats')
def stats():
    auto_expire()
    conn = get_db()
    rows = conn.execute("SELECT * FROM coupons").fetchall()
    conn.close()

    total = len(rows)
    active = sum(1 for r in rows if compute_status(r) == 'active')
    used = sum(1 for r in rows if compute_status(r) == 'used')
    expired = sum(1 for r in rows if compute_status(r) == 'expired')

    return jsonify({
        'total': total,
        'active': active,
        'used': used,
        'expired': expired,
    })


@app.route('/api/coupons')
def list_coupons():
    auto_expire()
    q = request.args.get('q', '').strip()
    conn = get_db()
    if q:
        like = '%' + q + '%'
        rows = conn.execute(
            "SELECT * FROM coupons WHERE code LIKE ? OR username LIKE ? ORDER BY created_at DESC",
            (like, like)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM coupons ORDER BY created_at DESC"
        ).fetchall()
    conn.close()
    return jsonify([enrich_coupon(r) for r in rows])


@app.route('/api/coupons', methods=['POST'])
def create_coupon():
    data = request.get_json()
    prefix = (data.get('prefix') or '').strip()
    username = (data.get('username') or '').strip()
    discount_type = data.get('discount_type')
    discount_value = data.get('discount_value')
    expiry_date = data.get('expiry_date')
    quantity = data.get('quantity', 1)

    if not discount_type or discount_value is None or not expiry_date:
        return jsonify({'error': 'لطفاً تمام فیلدها را پر کنید'}), 400
    err = validate_discount(discount_type, discount_value)
    if err:
        return jsonify({'error': err}), 400
    discount_value = float(discount_value)
    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        return jsonify({'error': 'تعداد باید عدد باشد'}), 400
    if quantity < 1:
        return jsonify({'error': 'تعداد باید حداقل ۱ باشد'}), 400
    code = generate_code(prefix)
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO coupons (code, username, discount_type, discount_value, expiry_date, quantity) VALUES (?, ?, ?, ?, ?, ?)",
            (code, username, discount_type, discount_value, expiry_date, quantity)
        )
        conn.commit()
        coupon_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.close()
        return jsonify({'id': coupon_id, 'code': code, 'username': username}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'خطا در تولید کد، دوباره تلاش کنید'}), 500


@app.route('/api/coupons/bulk', methods=['POST'])
def create_coupons_bulk():
    data = request.get_json()
    usernames = data.get('usernames', [])
    if not usernames or not isinstance(usernames, list):
        return jsonify({'error': 'لیست نام کاربری ارسال نشده'}), 400

    prefix = (data.get('prefix') or '').strip()
    discount_type = data.get('discount_type')
    discount_value = data.get('discount_value')
    expiry_date = data.get('expiry_date')
    quantity = data.get('quantity', 1)

    if not discount_type or discount_value is None or not expiry_date:
        return jsonify({'error': 'لطفاً تمام فیلدها را پر کنید'}), 400
    err = validate_discount(discount_type, discount_value)
    if err:
        return jsonify({'error': err}), 400
    discount_value = float(discount_value)
    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        return jsonify({'error': 'تعداد باید عدد باشد'}), 400
    if quantity < 1:
        return jsonify({'error': 'تعداد باید حداقل ۱ باشد'}), 400

    conn = get_db()
    created = []
    errors = []
    for u in usernames:
        u = u.strip()
        if not u:
            continue
        code = generate_code(prefix)
        try:
            conn.execute(
                "INSERT INTO coupons (code, username, discount_type, discount_value, expiry_date, quantity) VALUES (?, ?, ?, ?, ?, ?)",
                (code, u, discount_type, discount_value, expiry_date, quantity)
            )
            conn.commit()
            cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            created.append({'id': cid, 'code': code, 'username': u})
        except sqlite3.IntegrityError:
            errors.append({'username': u, 'error': 'خطا در تولید کد'})
    conn.close()

    return jsonify({
        'created': created,
        'errors': errors,
        'total_created': len(created),
        'total_errors': len(errors),
    }), 201 if created else 400


@app.route('/api/usernames')
def list_usernames():
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT username FROM coupons WHERE username != '' ORDER BY username"
    ).fetchall()
    conn.close()
    return jsonify([r['username'] for r in rows])


@app.route('/api/coupons/<int:coupon_id>/use', methods=['PUT'])
def use_coupon(coupon_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM coupons WHERE id=?", (coupon_id,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'کوپن یافت نشد'}), 404
    if compute_status(row) != 'active':
        conn.close()
        return jsonify({'error': 'کوپن فعال نیست یا به حداکثر استفاده رسیده'}), 400

    new_count = row['used_count'] + 1
    new_status = 'used' if new_count >= row['quantity'] else 'active'
    conn.execute(
        "UPDATE coupons SET used_count=?, status=? WHERE id=?",
        (new_count, new_status, coupon_id)
    )
    conn.commit()
    conn.close()
    return jsonify({
        'message': 'کوپن با موفقیت به‌روزرسانی شد',
        'used_count': new_count,
        'remaining': max(0, row['quantity'] - new_count),
    })


@app.route('/api/coupons/<int:coupon_id>', methods=['DELETE'])
def delete_coupon(coupon_id):
    conn = get_db()
    conn.execute("DELETE FROM coupons WHERE id=?", (coupon_id,))
    conn.commit()
    if conn.total_changes == 0:
        conn.close()
        return jsonify({'error': 'کوپن یافت نشد'}), 404
    conn.close()
    return jsonify({'message': 'کوپن با موفقیت حذف شد'})


@app.route('/api/export/json')
def export_json():
    conn = get_db()
    rows = conn.execute("SELECT * FROM coupons ORDER BY id").fetchall()
    conn.close()
    data = [{
        'code': r['code'],
        'username': r['username'],
        'discount_type': r['discount_type'],
        'discount_value': r['discount_value'],
        'expiry_date': r['expiry_date'],
        'quantity': r['quantity'],
        'used_count': r['used_count'],
        'status': r['status'],
        'created_at': r['created_at'],
    } for r in rows]
    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        mimetype='application/json; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename=coupons-backup.json'}
    )


@app.route('/api/import/json', methods=['POST'])
def import_json():
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'فایلی ارسال نشده'}), 400
    try:
        data = json.loads(file.read().decode('utf-8'))
    except Exception:
        return jsonify({'error': 'فرمت JSON نامعتبر است'}), 400
    if not isinstance(data, list):
        return jsonify({'error': 'فرمت فایل نامعتبر است (آرایه مورد نیاز)'}), 400

    _auto_backup_db()
    conn = get_db()
    imported = 0
    for item in data:
        code = item.get('code', '').strip()
        if not code:
            continue
        username = (item.get('username') or '').strip()
        discount_type = item.get('discount_type')
        discount_value = item.get('discount_value')
        expiry_date = item.get('expiry_date')
        quantity = int(item.get('quantity', 1))
        used_count = int(item.get('used_count', 0))
        status = item.get('status', 'active')
        created_at = item.get('created_at')
        err = validate_discount(discount_type, discount_value)
        if err or not expiry_date:
            continue
        try:
            conn.execute(
                "INSERT INTO coupons (code, username, discount_type, discount_value, expiry_date, quantity, used_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))",
                (code, username, discount_type, float(discount_value), expiry_date, quantity, used_count, status, created_at)
            )
            conn.commit()
            imported += 1
        except sqlite3.IntegrityError:
            pass
    conn.close()
    return jsonify({'imported': imported, 'message': f'{imported} کد تخفیف وارد شد'})


@app.route('/api/export/db')
def export_db():
    db_path = get_db_path()
    return send_file(
        db_path,
        mimetype='application/octet-stream',
        as_attachment=True,
        download_name='coupons-database.db'
    )


@app.route('/api/import/db', methods=['POST'])
def import_db():
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'فایلی ارسال نشده'}), 400

    backup_path = _auto_backup_db()
    db_path = get_db_path()
    try:
        file.save(db_path)
        init_db()
        return jsonify({'message': 'دیتابیس با موفقیت جایگزین شد', 'backup': backup_path})
    except Exception as e:
        return jsonify({'error': f'خطا در جایگزینی دیتابیس: {str(e)}'}), 500


def _auto_backup_db():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        return None
    backup_dir = os.path.join(os.path.dirname(db_path), 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = os.path.join(backup_dir, f'coupons_{timestamp}.db')
    shutil.copy2(db_path, backup_path)
    return backup_path


@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    os._exit(0)


def open_browser():
    webbrowser.open('http://127.0.0.1:5000')


if __name__ == '__main__':
    init_db()
    threading.Timer(1.5, open_browser).start()
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
