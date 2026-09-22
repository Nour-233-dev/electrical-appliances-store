/* =====================================================================
   نظام إدارة مبيعات وأقساط الأجهزة الكهربائية
   جميع البيانات تُحفظ محليًا داخل المتصفح باستخدام localStorage
   ===================================================================== */

const STORAGE_KEY = "electro_sales_data_v1";

/* ---------------------------------------------------------------------
   1) طبقة البيانات (Data Layer)
   --------------------------------------------------------------------- */
let sales = [];

function loadSales() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    sales = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sales)) sales = [];
  } catch (e) {
    console.error("تعذر قراءة البيانات المحفوظة:", e);
    sales = [];
  }
}

function saveSales() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
  } catch (e) {
    console.error("تعذر حفظ البيانات:", e);
    showToast("حدث خطأ أثناء حفظ البيانات على هذا الجهاز.", "error");
  }
}

function generateId() {
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------------------
   2) دوال مساعدة عامة
   --------------------------------------------------------------------- */

// حماية من مشاكل XSS عند إدراج نصوص المستخدم داخل HTML
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " جنيه";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "-";
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addMonths(dateISO, months) {
  const d = new Date(dateISO + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

function showToast(message, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast show " + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.className = "toast " + type;
  }, 2600);
}

/* ---------------------------------------------------------------------
   3) الحسابات الخاصة بالبيع والتقسيط
   --------------------------------------------------------------------- */

// إجمالي المدفوع = المقدم + كل الدفعات المسجلة (بالنسبة للكاش يكون المدفوع = الإجمالي)
function getPaidTotal(sale) {
  if (sale.saleType === "cash") return sale.totalPrice;
  const paymentsSum = (sale.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return Number(sale.downPayment || 0) + paymentsSum;
}

function getRemaining(sale) {
  const remaining = Number(sale.totalPrice || 0) - getPaidTotal(sale);
  return remaining > 0 ? Math.round(remaining * 100) / 100 : 0;
}

// عدد الأقساط "المسدَّدة تقريبًا" بناءً على المبلغ المدفوع بعد المقدم، يُستخدم لحساب ميعاد القسط القادم فقط
function getPaidInstallmentsCount(sale) {
  if (sale.saleType !== "installment" || !sale.installmentValue) return 0;
  const paidAfterDown = (sale.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return Math.floor(paidAfterDown / sale.installmentValue);
}

// تاريخ استحقاق القسط القادم (شهري بدءًا من تاريخ أول قسط)
function getNextDueDate(sale) {
  if (sale.saleType !== "installment") return null;
  if (getRemaining(sale) <= 0) return null;
  if (!sale.firstInstallmentDate) return null;
  const paidCount = getPaidInstallmentsCount(sale);
  if (paidCount >= sale.installmentsCount) return null;
  return addMonths(sale.firstInstallmentDate, paidCount);
}

function getDueStatus(sale) {
  const nextDue = getNextDueDate(sale);
  if (!nextDue) return null;
  const diff = daysBetween(nextDue, todayISO()); // موجب = متبقي أيام، سالب = متأخر
  if (diff < 0) return { category: "overdue", date: nextDue, diff };
  if (diff === 0) return { category: "today", date: nextDue, diff };
  if (diff <= 7) return { category: "week", date: nextDue, diff };
  return { category: "later", date: nextDue, diff };
}

/* ---------------------------------------------------------------------
   4) عناصر DOM
   --------------------------------------------------------------------- */
const el = {
  statsGrid: document.getElementById("statsGrid"),
  salesTableBody: document.getElementById("salesTableBody"),
  salesEmptyHint: document.getElementById("salesEmptyHint"),
  dueTableBody: document.getElementById("dueTableBody"),
  dueEmptyHint: document.getElementById("dueEmptyHint"),
  countOverdue: document.getElementById("countOverdue"),
  countToday: document.getElementById("countToday"),
  countWeek: document.getElementById("countWeek"),
  searchInput: document.getElementById("searchInput"),

  saleModalOverlay: document.getElementById("saleModalOverlay"),
  saleModalTitle: document.getElementById("saleModalTitle"),
  saleForm: document.getElementById("saleForm"),
  saleId: document.getElementById("saleId"),
  customerName: document.getElementById("customerName"),
  village: document.getElementById("village"),
  phone: document.getElementById("phone"),
  deviceType: document.getElementById("deviceType"),
  brand: document.getElementById("brand"),
  manufactureYear: document.getElementById("manufactureYear"),
  purchaseDate: document.getElementById("purchaseDate"),
  totalPrice: document.getElementById("totalPrice"),
  downPayment: document.getElementById("downPayment"),
  installmentsCount: document.getElementById("installmentsCount"),
  firstInstallmentDate: document.getElementById("firstInstallmentDate"),
  calcRemaining: document.getElementById("calcRemaining"),
  calcInstallmentValue: document.getElementById("calcInstallmentValue"),

  paymentModalOverlay: document.getElementById("paymentModalOverlay"),
  paymentSaleId: document.getElementById("paymentSaleId"),
  paymentSummary: document.getElementById("paymentSummary"),
  paymentForm: document.getElementById("paymentForm"),
  paymentDate: document.getElementById("paymentDate"),
  paymentAmount: document.getElementById("paymentAmount"),
  paymentsHistory: document.getElementById("paymentsHistory"),

  confirmModalOverlay: document.getElementById("confirmModalOverlay"),
  confirmModalText: document.getElementById("confirmModalText"),
};

let activeDueTab = "overdue";
let pendingDeleteId = null;

/* ---------------------------------------------------------------------
   5) عرض الإحصائيات
   --------------------------------------------------------------------- */
function renderStats() {
  const totalSales = sales.length;
  const totalAmount = sales.reduce((sum, s) => sum + Number(s.totalPrice || 0), 0);
  const totalPaid = sales.reduce((sum, s) => sum + getPaidTotal(s), 0);
  const totalRemaining = sales.reduce((sum, s) => sum + getRemaining(s), 0);
  const cashCount = sales.filter((s) => s.saleType === "cash").length;
  const installmentCount = sales.filter((s) => s.saleType === "installment").length;

  const cards = [
    { label: "إجمالي عدد العملاء / المبيعات", value: totalSales, cls: "" },
    { label: "إجمالي المبيعات", value: formatMoney(totalAmount), cls: "accent" },
    { label: "إجمالي المبالغ المدفوعة", value: formatMoney(totalPaid), cls: "success" },
    { label: "إجمالي المبالغ المتبقية", value: formatMoney(totalRemaining), cls: "danger" },
    { label: "عدد عمليات التقسيط", value: installmentCount, cls: "" },
    { label: "عدد عمليات الكاش", value: cashCount, cls: "success" },
  ];

  el.statsGrid.innerHTML = cards
    .map(
      (c) => `
      <div class="stat-card ${c.cls}">
        <div class="stat-label">${escapeHTML(c.label)}</div>
        <div class="stat-value">${escapeHTML(String(c.value))}</div>
      </div>`
    )
    .join("");
}

/* ---------------------------------------------------------------------
   6) عرض جدول الأقساط المستحقة
   --------------------------------------------------------------------- */
function renderDuePanel() {
  const dueList = sales
    .map((s) => ({ sale: s, status: getDueStatus(s) }))
    .filter((x) => x.status && ["overdue", "today", "week"].includes(x.status.category));

  const counts = { overdue: 0, today: 0, week: 0 };
  dueList.forEach((x) => counts[x.status.category]++);
  el.countOverdue.textContent = counts.overdue;
  el.countToday.textContent = counts.today;
  el.countWeek.textContent = counts.week;

  const filtered = dueList
    .filter((x) => x.status.category === activeDueTab)
    .sort((a, b) => a.status.diff - b.status.diff);

  if (filtered.length === 0) {
    el.dueTableBody.innerHTML = "";
    el.dueEmptyHint.style.display = "block";
    return;
  }
  el.dueEmptyHint.style.display = "none";

  el.dueTableBody.innerHTML = filtered
    .map(({ sale, status }) => {
      const badgeClass =
        status.category === "overdue" ? "badge-overdue" : status.category === "today" ? "badge-today" : "badge-week";
      const label =
        status.category === "overdue" ? `متأخر ${Math.abs(status.diff)} يوم` : status.category === "today" ? "اليوم" : `خلال ${status.diff} يوم`;
      return `
      <tr>
        <td>${escapeHTML(sale.customerName)}</td>
        <td>${escapeHTML(sale.phone)}</td>
        <td>${formatMoney(sale.installmentValue)}</td>
        <td>${formatDate(status.date)} <span class="badge ${badgeClass}">${label}</span></td>
        <td>${formatMoney(getRemaining(sale))}</td>
      </tr>`;
    })
    .join("");
}

/* ---------------------------------------------------------------------
   7) عرض جدول المبيعات مع دعم البحث
   --------------------------------------------------------------------- */
function getFilteredSales() {
  const q = (el.searchInput.value || "").trim().toLowerCase();
  if (!q) return sales;
  return sales.filter((s) => {
    return (
      (s.customerName || "").toLowerCase().includes(q) ||
      (s.phone || "").toLowerCase().includes(q) ||
      (s.village || "").toLowerCase().includes(q)
    );
  });
}

function renderSalesTable() {
  const list = getFilteredSales().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (list.length === 0) {
    el.salesTableBody.innerHTML = "";
    el.salesEmptyHint.style.display = "block";
    el.salesEmptyHint.textContent = sales.length === 0
      ? 'لا توجد بيانات بعد. اضغط "عملية بيع جديدة" للبدء.'
      : "لا توجد نتائج مطابقة لبحثك.";
    return;
  }
  el.salesEmptyHint.style.display = "none";

  el.salesTableBody.innerHTML = list
    .map((s) => {
      const remaining = getRemaining(s);
      const paid = getPaidTotal(s);
      const nextDue = getNextDueDate(s);
      const typeBadge =
        s.saleType === "cash"
          ? `<span class="badge badge-cash">كاش</span>`
          : `<span class="badge badge-installment">تقسيط</span>`;

      return `
      <tr>
        <td>${escapeHTML(s.customerName)}</td>
        <td>${escapeHTML(s.village)}</td>
        <td>${escapeHTML(s.phone)}</td>
        <td>${escapeHTML(s.deviceType)}</td>
        <td>${escapeHTML(s.brand)}</td>
        <td>${formatMoney(s.totalPrice)}</td>
        <td>${typeBadge}</td>
        <td>${formatMoney(paid)}</td>
        <td>${formatMoney(remaining)}</td>
        <td>${s.saleType === "installment" ? formatMoney(s.installmentValue) : "-"}</td>
        <td>${nextDue ? formatDate(nextDue) : (s.saleType === "installment" ? "تم السداد" : "-")}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-outline btn-small" data-action="edit" data-id="${s.id}">تعديل</button>
            ${s.saleType === "installment" ? `<button class="btn btn-outline btn-small" data-action="pay" data-id="${s.id}">إضافة دفعة</button>` : ""}
            <button class="btn btn-danger btn-small" data-action="delete" data-id="${s.id}">حذف</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderAll() {
  renderStats();
  renderDuePanel();
  renderSalesTable();
}

/* ---------------------------------------------------------------------
   8) منطق نافذة إضافة / تعديل عملية بيع
   --------------------------------------------------------------------- */
function getSaleTypeValue() {
  const checked = el.saleForm.querySelector('input[name="saleType"]:checked');
  return checked ? checked.value : "cash";
}

function setSaleTypeValue(value) {
  const radio = el.saleForm.querySelector(`input[name="saleType"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function updateInstallmentFieldsVisibility() {
  const isInstallment = getSaleTypeValue() === "installment";
  document.querySelectorAll(".installment-field").forEach((f) => {
    f.classList.toggle("disabled", !isInstallment);
  });
  if (!isInstallment) {
    el.downPayment.value = el.totalPrice.value || 0;
  }
  recalcLiveValues();
}

function recalcLiveValues() {
  const isInstallment = getSaleTypeValue() === "installment";
  const total = Number(el.totalPrice.value) || 0;

  if (!isInstallment) {
    el.calcRemaining.textContent = formatMoney(0);
    el.calcInstallmentValue.textContent = formatMoney(0);
    return;
  }

  const down = Number(el.downPayment.value) || 0;
  const count = Number(el.installmentsCount.value) || 0;
  const remaining = Math.max(total - down, 0);
  const perInstallment = count > 0 ? remaining / count : 0;

  el.calcRemaining.textContent = formatMoney(remaining);
  el.calcInstallmentValue.textContent = formatMoney(perInstallment);
}

function resetSaleForm() {
  el.saleForm.reset();
  el.saleId.value = "";
  setSaleTypeValue("cash");
  el.purchaseDate.value = todayISO();
  el.downPayment.value = 0;
  updateInstallmentFieldsVisibility();
}

function openSaleModalForCreate() {
  resetSaleForm();
  el.saleModalTitle.textContent = "عملية بيع جديدة";
  el.saleModalOverlay.classList.add("open");
  setTimeout(() => el.customerName.focus(), 50);
}

function openSaleModalForEdit(id) {
  const sale = sales.find((s) => s.id === id);
  if (!sale) return;

  resetSaleForm();
  el.saleModalTitle.textContent = "تعديل بيانات عملية البيع";
  el.saleId.value = sale.id;
  el.customerName.value = sale.customerName;
  el.village.value = sale.village;
  el.phone.value = sale.phone;
  el.deviceType.value = sale.deviceType;
  el.brand.value = sale.brand;
  el.manufactureYear.value = sale.manufactureYear || "";
  el.purchaseDate.value = sale.purchaseDate;
  el.totalPrice.value = sale.totalPrice;
  setSaleTypeValue(sale.saleType);

  if (sale.saleType === "installment") {
    el.downPayment.value = sale.downPayment;
    el.installmentsCount.value = sale.installmentsCount;
    el.firstInstallmentDate.value = sale.firstInstallmentDate || "";
  } else {
    el.downPayment.value = sale.totalPrice;
  }

  updateInstallmentFieldsVisibility();
  el.saleModalOverlay.classList.add("open");
  setTimeout(() => el.customerName.focus(), 50);
}

function closeSaleModal() {
  el.saleModalOverlay.classList.remove("open");
}

function handleSaleFormSubmit(e) {
  e.preventDefault();

  const saleType = getSaleTypeValue();
  const totalPrice = Number(el.totalPrice.value) || 0;

  if (!el.customerName.value.trim() || !el.village.value.trim() || !el.phone.value.trim() || !el.deviceType.value.trim() || !el.brand.value.trim() || !el.purchaseDate.value) {
    showToast("من فضلك أكملي جميع الحقول المطلوبة.", "error");
    return;
  }
  if (totalPrice <= 0) {
    showToast("من فضلك أدخلي سعر جهاز صحيح.", "error");
    return;
  }

  let downPayment = 0, installmentsCount = 0, installmentValue = 0, firstInstallmentDate = "";

  if (saleType === "installment") {
    downPayment = Number(el.downPayment.value) || 0;
    installmentsCount = Number(el.installmentsCount.value) || 0;
    firstInstallmentDate = el.firstInstallmentDate.value;

    if (downPayment < 0 || downPayment > totalPrice) {
      showToast("المقدم المدفوع غير صحيح، يجب ألا يتجاوز إجمالي السعر.", "error");
      return;
    }
    if (installmentsCount <= 0) {
      showToast("من فضلك أدخلي عدد أقساط صحيح.", "error");
      return;
    }
    if (!firstInstallmentDate) {
      showToast("من فضلك أدخلي تاريخ أول قسط.", "error");
      return;
    }
    installmentValue = Math.round(((totalPrice - downPayment) / installmentsCount) * 100) / 100;
  } else {
    downPayment = totalPrice; // كاش = مدفوع بالكامل
  }

  const existingId = el.saleId.value;

  if (existingId) {
    const sale = sales.find((s) => s.id === existingId);
    if (!sale) return;
    Object.assign(sale, {
      customerName: el.customerName.value.trim(),
      village: el.village.value.trim(),
      phone: el.phone.value.trim(),
      deviceType: el.deviceType.value.trim(),
      brand: el.brand.value.trim(),
      manufactureYear: el.manufactureYear.value ? Number(el.manufactureYear.value) : "",
      purchaseDate: el.purchaseDate.value,
      saleType,
      totalPrice,
      downPayment,
      installmentsCount,
      installmentValue,
      firstInstallmentDate,
    });
    if (saleType === "cash") sale.payments = [];
    showToast("تم تحديث بيانات عملية البيع بنجاح.", "success");
  } else {
    const newSale = {
      id: generateId(),
      customerName: el.customerName.value.trim(),
      village: el.village.value.trim(),
      phone: el.phone.value.trim(),
      deviceType: el.deviceType.value.trim(),
      brand: el.brand.value.trim(),
      manufactureYear: el.manufactureYear.value ? Number(el.manufactureYear.value) : "",
      purchaseDate: el.purchaseDate.value,
      saleType,
      totalPrice,
      downPayment,
      installmentsCount,
      installmentValue,
      firstInstallmentDate,
      payments: [],
      createdAt: Date.now(),
    };
    sales.push(newSale);
    showToast("تم حفظ عملية البيع بنجاح.", "success");
  }

  saveSales();
  renderAll();
  closeSaleModal();

  // تفريغ النموذج وإعادة المؤشر لأول حقل استعدادًا لعملية بيع جديدة
  resetSaleForm();
}

/* ---------------------------------------------------------------------
   9) منطق نافذة الدفعات
   --------------------------------------------------------------------- */
function openPaymentModal(id) {
  const sale = sales.find((s) => s.id === id);
  if (!sale) return;

  el.paymentSaleId.value = id;
  el.paymentDate.value = todayISO();
  el.paymentAmount.value = "";
  renderPaymentSummary(sale);
  renderPaymentsHistory(sale);

  el.paymentModalOverlay.classList.add("open");
  setTimeout(() => el.paymentAmount.focus(), 50);
}

function renderPaymentSummary(sale) {
  el.paymentSummary.innerHTML = `
    <div>العميل: <b>${escapeHTML(sale.customerName)}</b></div>
    <div>الجهاز: <b>${escapeHTML(sale.deviceType)} - ${escapeHTML(sale.brand)}</b></div>
    <div>إجمالي السعر: <b>${formatMoney(sale.totalPrice)}</b></div>
    <div>إجمالي المدفوع: <b>${formatMoney(getPaidTotal(sale))}</b></div>
    <div>المبلغ المتبقي: <b>${formatMoney(getRemaining(sale))}</b></div>
    <div>قيمة القسط: <b>${formatMoney(sale.installmentValue)}</b></div>
  `;
}

function renderPaymentsHistory(sale) {
  const payments = sale.payments || [];
  if (payments.length === 0) {
    el.paymentsHistory.innerHTML = `<h4>سجل الدفعات</h4><p class="empty-hint" style="display:block;">لا توجد دفعات مسجلة بعد.</p>`;
    return;
  }
  let runningPaid = Number(sale.downPayment || 0);
  const rows = payments
    .map((p) => {
      runningPaid += Number(p.amount || 0);
      const remainingAfter = Math.max(sale.totalPrice - runningPaid, 0);
      return `<tr>
        <td>${formatDate(p.date)}</td>
        <td>${formatMoney(p.amount)}</td>
        <td>${formatMoney(runningPaid)}</td>
        <td>${formatMoney(remainingAfter)}</td>
      </tr>`;
    })
    .join("");

  el.paymentsHistory.innerHTML = `
    <h4>سجل الدفعات</h4>
    <table>
      <thead><tr><th>تاريخ الدفع</th><th>قيمة الدفعة</th><th>إجمالي المدفوع</th><th>المتبقي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function closePaymentModal() {
  el.paymentModalOverlay.classList.remove("open");
}

function handlePaymentFormSubmit(e) {
  e.preventDefault();
  const id = el.paymentSaleId.value;
  const sale = sales.find((s) => s.id === id);
  if (!sale) return;

  const amount = Number(el.paymentAmount.value);
  const remaining = getRemaining(sale);

  if (!amount || amount <= 0) {
    showToast("من فضلك أدخلي قيمة دفعة صحيحة.", "error");
    return;
  }
  if (amount > remaining) {
    showToast(`قيمة الدفعة أكبر من المتبقي (${formatMoney(remaining)}).`, "error");
    return;
  }
  if (!el.paymentDate.value) {
    showToast("من فضلك أدخلي تاريخ الدفعة.", "error");
    return;
  }

  sale.payments = sale.payments || [];
  sale.payments.push({
    id: generateId(),
    date: el.paymentDate.value,
    amount,
  });

  saveSales();
  renderAll();
  showToast("تم تسجيل الدفعة بنجاح.", "success");

  renderPaymentSummary(sale);
  renderPaymentsHistory(sale);
  el.paymentAmount.value = "";
  el.paymentDate.value = todayISO();
  el.paymentAmount.focus();
}

/* ---------------------------------------------------------------------
   10) الحذف مع رسالة تأكيد
   --------------------------------------------------------------------- */
function requestDelete(id) {
  const sale = sales.find((s) => s.id === id);
  if (!sale) return;
  pendingDeleteId = id;
  el.confirmModalText.textContent = `هل أنت متأكدة من حذف عملية بيع "${sale.deviceType} - ${sale.brand}" الخاصة بالعميل "${sale.customerName}"؟ لا يمكن التراجع عن هذا الإجراء.`;
  el.confirmModalOverlay.classList.add("open");
}

function closeConfirmModal() {
  pendingDeleteId = null;
  el.confirmModalOverlay.classList.remove("open");
}

function confirmDeleteAction() {
  if (!pendingDeleteId) return;
  sales = sales.filter((s) => s.id !== pendingDeleteId);
  saveSales();
  renderAll();
  showToast("تم حذف عملية البيع.", "success");
  closeConfirmModal();
}

/* ---------------------------------------------------------------------
   11) التصدير والاستيراد (النسخ الاحتياطي)
   --------------------------------------------------------------------- */
function exportData() {
  const dataStr = JSON.stringify(sales, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateTag = todayISO();
  a.href = url;
  a.download = `نسخة_احتياطية_${dateTag}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("تم تنزيل النسخة الاحتياطية بنجاح.", "success");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error("صيغة الملف غير صحيحة");

      const isValid = parsed.every((item) => item && typeof item === "object" && "customerName" in item);
      if (!isValid) throw new Error("الملف لا يحتوي على بيانات مبيعات صحيحة");

      sales = parsed;
      saveSales();
      renderAll();
      showToast("تم استيراد البيانات بنجاح.", "success");
    } catch (err) {
      console.error(err);
      showToast("تعذر استيراد الملف. تأكدي أنه نسخة احتياطية صحيحة.", "error");
    }
  };
  reader.readAsText(file, "utf-8");
}

/* ---------------------------------------------------------------------
   12) التنقل بين الحقول باستخدام Enter
   --------------------------------------------------------------------- */
function enableEnterNavigation(formElement) {
  formElement.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const target = e.target;
    if (target.tagName === "TEXTAREA") return;
    if (target.tagName !== "INPUT") return;

    e.preventDefault();
    const focusable = Array.from(
      formElement.querySelectorAll("input:not([type=hidden]):not(:disabled), button[type=submit]")
    ).filter((f) => f.offsetParent !== null); // تجاهل الحقول المخفية

    const currentIndex = focusable.indexOf(target);
    if (currentIndex > -1 && currentIndex < focusable.length - 1) {
      focusable[currentIndex + 1].focus();
    } else {
      formElement.requestSubmit ? formElement.requestSubmit() : formElement.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
}

/* ---------------------------------------------------------------------
   13) ربط الأحداث (Event Listeners)
   --------------------------------------------------------------------- */
function bindEvents() {
  document.getElementById("btnNewSale").addEventListener("click", openSaleModalForCreate);
  document.getElementById("closeSaleModal").addEventListener("click", closeSaleModal);
  document.getElementById("cancelSaleForm").addEventListener("click", closeSaleModal);
  el.saleForm.addEventListener("submit", handleSaleFormSubmit);

  el.saleForm.querySelectorAll('input[name="saleType"]').forEach((r) => {
    r.addEventListener("change", updateInstallmentFieldsVisibility);
  });
  [el.totalPrice, el.downPayment, el.installmentsCount].forEach((input) => {
    input.addEventListener("input", recalcLiveValues);
  });

  document.getElementById("closePaymentModal").addEventListener("click", closePaymentModal);
  document.getElementById("cancelPaymentForm").addEventListener("click", closePaymentModal);
  el.paymentForm.addEventListener("submit", handlePaymentFormSubmit);

  document.getElementById("closeConfirmModal").addEventListener("click", closeConfirmModal);
  document.getElementById("cancelDelete").addEventListener("click", closeConfirmModal);
  document.getElementById("confirmDelete").addEventListener("click", confirmDeleteAction);

  document.getElementById("btnExport").addEventListener("click", exportData);
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = "";
  });

  el.searchInput.addEventListener("input", renderSalesTable);

  el.salesTableBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "edit") openSaleModalForEdit(id);
    if (action === "pay") openPaymentModal(id);
    if (action === "delete") requestDelete(id);
  });

  document.getElementById("dueTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".due-tab");
    if (!btn) return;
    activeDueTab = btn.dataset.tab;
    document.querySelectorAll(".due-tab").forEach((t) => t.classList.toggle("active", t === btn));
    renderDuePanel();
  });

  // إغلاق النوافذ عند الضغط خارج المحتوى
  [el.saleModalOverlay, el.paymentModalOverlay, el.confirmModalOverlay].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });

  // إغلاق بمفتاح Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open"));
    }
  });

  enableEnterNavigation(el.saleForm);
  enableEnterNavigation(el.paymentForm);
}

/* ---------------------------------------------------------------------
   14) بدء التشغيل
   --------------------------------------------------------------------- */
function init() {
  loadSales();
  bindEvents();
  el.purchaseDate.value = todayISO();
  updateInstallmentFieldsVisibility();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
