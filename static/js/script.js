// ---- State ----
let coupons = [];
let isLoading = false;
let filterTimeout = null;

// ---- Jalali (Persian) Calendar utilities ----
const JALALI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

function getTodayJalali() {
    const now = new Date();
    return jalaali.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function getJalaliMonthDays(jy, jm) {
    return jalaali.jalaaliMonthLength(jy, jm);
}

function initJalaliPicker(prefix) {
    const today = getTodayJalali();
    const yearSelect = document.getElementById(prefix + '-jalali-year');
    const monthSelect = document.getElementById(prefix + '-jalali-month');
    const daySelect = document.getElementById(prefix + '-jalali-day');

    if (!yearSelect) return;

    yearSelect.innerHTML = '';
    for (let y = today.jy - 1; y <= today.jy + 5; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === today.jy) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    monthSelect.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = JALALI_MONTHS[m - 1];
        if (m === today.jm) opt.selected = true;
        monthSelect.appendChild(opt);
    }

    updateJalaliDays(prefix);
}

function updateJalaliDays(prefix) {
    const year = parseInt(document.getElementById(prefix + '-jalali-year').value);
    const month = parseInt(document.getElementById(prefix + '-jalali-month').value);
    const today = getTodayJalali();
    const daySelect = document.getElementById(prefix + '-jalali-day');
    if (!daySelect) return;
    const maxDays = getJalaliMonthDays(year, month);

    const currentVal = parseInt(daySelect.value);
    daySelect.innerHTML = '';
    for (let d = 1; d <= maxDays; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (d === (currentVal >= 1 && currentVal <= maxDays ? currentVal : Math.min(today.jd, maxDays))) {
            opt.selected = true;
        }
        daySelect.appendChild(opt);
    }
}

function jalaliPickerToGregorian(prefix) {
    const jy = parseInt(document.getElementById(prefix + '-jalali-year').value);
    const jm = parseInt(document.getElementById(prefix + '-jalali-month').value);
    const jd = parseInt(document.getElementById(prefix + '-jalali-day').value);
    const g = jalaali.toGregorian(jy, jm, jd);
    const gy = String(g.gy).padStart(4, '0');
    const gm = String(g.gm).padStart(2, '0');
    const gd = String(g.gd).padStart(2, '0');
    return gy + '-' + gm + '-' + gd;
}

function gregorianToJalaliStr(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    const j = jalaali.toJalaali(
        parseInt(parts[0]),
        parseInt(parts[1]),
        parseInt(parts[2])
    );
    return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0');
}

// ---- API helpers ----
async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'خطا در ارتباط با سرور');
    }
    return res.json();
}

async function apiPost(url, data) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'خطا در ارتباط با سرور');
    }
    return res.json();
}

async function apiPut(url) {
    const res = await fetch(url, { method: 'PUT' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'خطا در ارتباط با سرور');
    }
    return res.json();
}

async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'خطا در ارتباط با سرور');
    }
    return res.json();
}

// ---- Toast ----
function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ---- Modal ----
function showModal(type) {
    document.getElementById('modal-' + type).classList.add('active');
    if (type === 'single') {
        initJalaliPicker('s');
        document.getElementById('s-prefix').focus();
    } else {
        initJalaliPicker('b');
        document.getElementById('b-usernames').focus();
    }
}

function hideModal(type) {
    document.getElementById('modal-' + type).classList.remove('active');
    const form = document.getElementById('form-' + type);
    if (form) form.reset();
    const btn = document.getElementById('submit-btn-' + type);
    if (btn) {
        btn.disabled = false;
        btn.textContent = type === 'single' ? 'تولید کد تخفیف' : 'تولید گروهی کد تخفیف';
    }
}

function handleOverlayClick(event, type) {
    if (event.target === event.currentTarget) {
        hideModal(type);
    }
}

// ---- Filter ----
function filterByUsername() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(function () {
        loadCoupons();
    }, 400);
}

function clearFilter() {
    document.getElementById('username-filter').value = '';
    document.getElementById('filter-info').textContent = '';
    loadCoupons();
}

// ---- Load data ----
async function loadStats() {
    try {
        const stats = await apiGet('/api/stats');
        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-active').textContent = stats.active;
        document.getElementById('stat-used').textContent = stats.used;
        document.getElementById('stat-expired').textContent = stats.expired;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadCoupons() {
    if (isLoading) return;
    isLoading = true;
    document.getElementById('loading-state').style.display = 'block';
    document.getElementById('empty-state').style.display = 'none';

    try {
        const filter = document.getElementById('username-filter').value.trim();
        const url = filter ? '/api/coupons?username=' + encodeURIComponent(filter) : '/api/coupons';
        coupons = await apiGet(url);
        renderCoupons(coupons);
        const info = document.getElementById('filter-info');
        if (filter) {
            info.textContent = coupons.length + ' نتیجه برای "' + filter + '"';
        } else {
            info.textContent = '';
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        isLoading = false;
        document.getElementById('loading-state').style.display = 'none';
    }
}

// ---- Render ----
function renderCoupons(coupons) {
    const tbody = document.getElementById('coupon-table-body');
    const emptyState = document.getElementById('empty-state');

    if (coupons.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    tbody.innerHTML = coupons.map(function (c, i) {
        const status = c.computed_status || c.status;
        const statusBadge = getStatusBadge(status);
        const typeText = c.discount_type === 'percentage'
            ? c.discount_value + '%'
            : c.discount_value.toLocaleString() + ' تومان';
        const typeLabel = c.discount_type === 'percentage' ? 'درصدی' : 'مبلغ ثابت';
        const qtyText = c.quantity + ' / ' + Math.max(0, c.quantity - c.used_count);
        const username = c.username || '-';
        const actions = getActionButtons(c, status);
        return [
            '<tr>',
            '<td>' + (i + 1) + '</td>',
            '<td><span class="coupon-code">' + c.code + '</span></td>',
            '<td><span class="username-cell">' + escapeHtml(username) + '</span></td>',
            '<td>' + typeLabel + '</td>',
            '<td>' + typeText + '</td>',
            '<td>' + gregorianToJalaliStr(c.expiry_date) + '</td>',
            '<td>' + qtyText + '</td>',
            '<td>' + statusBadge + '</td>',
            '<td>' + actions + '</td>',
            '</tr>',
        ].join('');
    }).join('');
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function getStatusBadge(status) {
    var map = {
        active: '<span class="badge badge-active">فعال</span>',
        used: '<span class="badge badge-used">استفاده شده</span>',
        expired: '<span class="badge badge-expired">منقضی شده</span>',
    };
    return map[status] || status;
}

function getActionButtons(c, status) {
    if (status === 'active') {
        return [
            '<div class="action-btns">',
            '<button class="btn btn-sm btn-success" onclick="useCoupon(' + c.id + ')">استفاده شد</button>',
            '<button class="btn btn-sm btn-danger" onclick="confirmDelete(' + c.id + ')">حذف</button>',
            '</div>',
        ].join('');
    }
    return '<button class="btn btn-sm btn-danger" onclick="confirmDelete(' + c.id + ')">حذف</button>';
}

// ---- Create Single ----
async function createCoupon(event) {
    event.preventDefault();
    const form = document.getElementById('form-single');
    const formData = new FormData(form);
    const submitBtn = document.getElementById('submit-btn-single');

    const username = (formData.get('username') || '').trim();
    if (!username) {
        showToast('لطفاً نام کاربری را وارد کنید', 'error');
        return;
    }

    const data = {
        prefix: formData.get('prefix') || 'تخفیف',
        username: username,
        discount_type: formData.get('discount_type'),
        discount_value: formData.get('discount_value'),
        quantity: formData.get('quantity') || 1,
        expiry_date: jalaliPickerToGregorian('s'),
    };

    if (!data.discount_value || parseFloat(data.discount_value) <= 0) {
        showToast('مقدار تخفیف باید بزرگتر از صفر باشد', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'در حال ایجاد...';

    try {
        const result = await apiPost('/api/coupons', data);
        showToast('کد تخفیف ' + result.code + ' برای ' + result.username + ' ایجاد شد', 'success');
        hideModal('single');
        await Promise.all([loadStats(), loadCoupons()]);
    } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'تولید کد تخفیف';
    }
}

// ---- Create Bulk ----
async function createCouponsBulk(event) {
    event.preventDefault();
    const form = document.getElementById('form-bulk');
    const formData = new FormData(form);
    const submitBtn = document.getElementById('submit-btn-bulk');

    const raw = formData.get('usernames') || '';
    const usernames = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });

    if (usernames.length === 0) {
        showToast('حداقل یک نام کاربری وارد کنید', 'error');
        return;
    }

    const data = {
        prefix: formData.get('prefix') || 'تخفیف',
        usernames: usernames,
        discount_type: formData.get('discount_type'),
        discount_value: formData.get('discount_value'),
        quantity: formData.get('quantity') || 1,
        expiry_date: jalaliPickerToGregorian('b'),
    };

    if (!data.discount_value || parseFloat(data.discount_value) <= 0) {
        showToast('مقدار تخفیف باید بزرگتر از صفر باشد', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'در حال ایجاد...';

    try {
        const result = await apiPost('/api/coupons/bulk', data);
        var msg = result.total_created + ' کد تخفیف با موفقیت ایجاد شد';
        if (result.total_errors > 0) {
            msg += '، ' + result.total_errors + ' خطا';
        }
        showToast(msg, 'success');
        hideModal('bulk');
        await Promise.all([loadStats(), loadCoupons()]);
    } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'تولید گروهی کد تخفیف';
    }
}

// ---- Use ----
async function useCoupon(id) {
    try {
        const result = await apiPut('/api/coupons/' + id + '/use');
        const remaining = result.remaining;
        let msg = 'کد تخفیف با موفقیت به‌روزرسانی شد';
        if (remaining > 0) {
            msg += ' (' + remaining + ' استفاده باقی‌مانده)';
        }
        showToast(msg, 'success');
        await Promise.all([loadStats(), loadCoupons()]);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---- Delete ----
function confirmDelete(id) {
    deleteCoupon(id);
}

async function deleteCoupon(id) {
    try {
        await apiDelete('/api/coupons/' + id);
        showToast('کد تخفیف با موفقیت حذف شد', 'info');
        await Promise.all([loadStats(), loadCoupons()]);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---- Export / Import ----


// ---- Shutdown ----
async function shutdown() {
    try {
        await fetch('/api/shutdown', { method: 'POST' });
    } catch (e) {
        // server may close before response
    }
}

// ---- Keyboard ----
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        hideModal('single');
        hideModal('bulk');
    }
});

// ---- Init ----
document.addEventListener('DOMContentLoaded', function () {
    loadStats();
    loadCoupons();
});
