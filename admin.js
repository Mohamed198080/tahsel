// admin.js - المدير
let rawTasks = []; // المهام المقروءة من Excel قبل التوزيع
let zonesData = [];
let map;
let zonesLayer, markersLayer;

// تهيئة الخريطة
function initMap() {
    map = L.map('map').setView([24.7136, 46.6753], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);
}

// دالة مرنة للبحث عن عمود في صف العناوين
function findColumnIndex(headers, possibleNames) {
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toString().trim().toLowerCase();
        for (let name of possibleNames) {
            if (header === name.toLowerCase() || header.includes(name.toLowerCase())) {
                return i;
            }
        }
    }
    return -1;
}

// قراءة ملف Excel باستخدام SheetJS مع دعم مرن للأعمدة
document.getElementById('readExcelBtn').addEventListener('click', () => {
    const file = document.getElementById('excelFile').files[0];
    if (!file) {
        alert('اختر ملف Excel أولاً');
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            if (!rows || rows.length < 2) {
                document.getElementById('excelPreview').innerHTML = '<span class="status-error">الملف فارغ أو لا يحتوي على بيانات</span>';
                return;
            }
            
            const headers = rows[0].map(cell => (cell ? cell.toString().trim() : ''));
            // البحث عن أسماء الأعمدة المرنة
            const meterIdx = findColumnIndex(headers, ['رقم العداد', 'العداد', 'meter', 'id', 'meter number']);
            const latIdx = findColumnIndex(headers, ['خط العرض', 'lat', 'latitude', 'عرض']);
            const lngIdx = findColumnIndex(headers, ['خط الطول', 'lng', 'longitude', 'long', 'طول']);
            const actionIdx = findColumnIndex(headers, ['الإجراء', 'action', 'نوع العمل', 'العملية', 'اجراء']);
            
            if (meterIdx === -1 || latIdx === -1 || lngIdx === -1 || actionIdx === -1) {
                let errorMsg = 'لم يتم العثور على الأعمدة المطلوبة.<br>';
                errorMsg += `وجدنا: ${headers.join(', ')}<br>`;
                errorMsg += 'تأكد من وجود أعمدة: "رقم العداد"، "خط العرض"، "خط الطول"، "الإجراء"';
                document.getElementById('excelPreview').innerHTML = `<span class="status-error">${errorMsg}</span>`;
                return;
            }
            
            rawTasks = [];
            let skipped = 0;
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const meter = row[meterIdx] ? row[meterIdx].toString().trim() : '';
                const lat = parseFloat(row[latIdx]);
                const lng = parseFloat(row[lngIdx]);
                const action = row[actionIdx] ? row[actionIdx].toString().trim() : '';
                
                if (!meter || isNaN(lat) || isNaN(lng) || !action) {
                    skipped++;
                    continue;
                }
                rawTasks.push({
                    MeterNumber: meter,
                    Lat: lat,
                    Lng: lng,
                    Action: action,
                    Notes: ""
                });
            }
            
            if (rawTasks.length === 0) {
                document.getElementById('excelPreview').innerHTML = '<span class="status-error">لا توجد بيانات صالحة في الملف. تأكد من الأرقام والإحداثيات.</span>';
                return;
            }
            
            // عرض معاينة
            let previewHtml = `<p class="status-ok">✅ تم قراءة ${rawTasks.length} عداد (تم تخطي ${skipped} صف غير صالح)</p>`;
            previewHtml += '<table class="preview-table"><tr><th>رقم العداد</th><th>خط العرض</th><th>خط الطول</th><th>الإجراء</th></tr>';
            for (let i = 0; i < Math.min(10, rawTasks.length); i++) {
                const t = rawTasks[i];
                previewHtml += `<tr><td>${t.MeterNumber}</td><td>${t.Lat}</td><td>${t.Lng}</td><td>${t.Action}</td></tr>`;
            }
            if (rawTasks.length > 10) previewHtml += `<tr><td colspan="4">... و ${rawTasks.length-10} صف آخر</td></tr>`;
            previewHtml += '</table>';
            document.getElementById('excelPreview').innerHTML = previewHtml;
        } catch (err) {
            console.error(err);
            document.getElementById('excelPreview').innerHTML = `<span class="status-error">خطأ في قراءة الملف: ${err.message}</span>`;
        }
    };
    reader.readAsArrayBuffer(file);
});

// رفع ملف KML إلى Apps Script
document.getElementById('uploadKmlBtn').addEventListener('click', async () => {
    const file = document.getElementById('kmlFile').files[0];
    if (!file) {
        alert('اختر ملف KML أولاً');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target.result;
            const encoded = encodeURIComponent(content);
            const response = await fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'uploadZones', kmlContent: encoded })
            });
            const data = await response.json();
            if (data.status === 'ok') {
                document.getElementById('kmlStatus').innerHTML = `<span class="status-ok">✅ تم رفع ${data.zones} منطقة</span>`;
                await loadZonesAndDraw();
                buildTeamsCountInputs();
            } else {
                document.getElementById('kmlStatus').innerHTML = `<span class="status-error">❌ خطأ: ${data.error}</span>`;
            }
        } catch (err) {
            document.getElementById('kmlStatus').innerHTML = `<span class="status-error">خطأ في الاتصال: ${err.message}</span>`;
        }
    };
    reader.readAsText(file);
});

// تحميل المناطق من الـ Sheet ورسمها
async function loadZonesAndDraw() {
    try {
        const res = await fetch(`${API_BASE}?action=getZones`);
        zonesData = await res.json();
        if (!Array.isArray(zonesData)) zonesData = [];
        if (zonesLayer) map.removeLayer(zonesLayer);
        zonesLayer = L.layerGroup().addTo(map);
        zonesData.forEach(zone => {
            const wkt = zone.PolygonWKT;
            if (wkt) {
                const coords = parseWKTToLeaflet(wkt);
                if (coords && coords.length > 0) {
                    const color = getTeamColor(zone.TeamID);
                    const polygon = L.polygon(coords, { color: color, weight: 2, fillOpacity: 0.2 }).addTo(zonesLayer);
                    polygon.bindPopup(`الفريق ${zone.TeamID}<br>${zone.ZoneName}`);
                }
            }
        });
    } catch (err) {
        console.error(err);
    }
}

function parseWKTToLeaflet(wkt) {
    const match = wkt.match(/POLYGON\(\((.*?)\)\)/);
    if (!match) return null;
    const points = match[1].split(",").map(pair => {
        const [lng, lat] = pair.trim().split(" ");
        return [parseFloat(lat), parseFloat(lng)];
    });
    return points;
}

function getTeamColor(teamId) {
    const colors = ['#e74c3c', '#f39c12', '#3498db', '#2ecc71', '#9b59b6'];
    return colors[(teamId-1) % colors.length];
}

// إنشاء حقول إدخال عدد العدادات لكل فريق
function buildTeamsCountInputs() {
    const container = document.getElementById('teamsCountInputs');
    container.innerHTML = '';
    if (!zonesData || zonesData.length === 0) {
        container.innerHTML = '<p class="status-error">لم يتم رفع المناطق بعد</p>';
        return;
    }
    const maxTeams = Math.min(zonesData.length, 5);
    for (let i = 1; i <= maxTeams; i++) {
        const div = document.createElement('div');
        div.className = 'team-count';
        div.innerHTML = `<label>الفريق ${i}</label>
                         <input type="number" id="teamCount${i}" min="0" value="0" step="1">`;
        container.appendChild(div);
    }
}

// توزيع العدادات
document.getElementById('distributeBtn').addEventListener('click', async () => {
    if (rawTasks.length === 0) {
        alert('لم تقم بقراءة ملف Excel بعد أو لا توجد بيانات صالحة');
        return;
    }
    if (!zonesData || zonesData.length === 0) {
        alert('لم تقم برفع ملف المناطق بعد');
        return;
    }
    const maxTeams = zonesData.length;
    const counts = [];
    let totalNeeded = 0;
    for (let i = 1; i <= maxTeams; i++) {
        const input = document.getElementById(`teamCount${i}`);
        if (!input) continue;
        const val = parseInt(input.value);
        if (isNaN(val) || val < 0) {
            alert(`أدخل عدداً صحيحاً للفريق ${i}`);
            return;
        }
        counts.push(val);
        totalNeeded += val;
    }
    if (totalNeeded !== rawTasks.length) {
        alert(`مجموع العدادات المطلوب توزيعها (${totalNeeded}) لا يساوي عدد العدادات المقروءة (${rawTasks.length})`);
        return;
    }
    
    // ترتيب العدادات من الجنوب إلى الشمال (حسب خط العرض تصاعديًا)
    const sortedTasks = [...rawTasks].sort((a,b) => a.Lat - b.Lat);
    
    // توزيعها على الفرق حسب الأعداد المطلوبة
    let distributed = [];
    let startIdx = 0;
    for (let teamIdx = 0; teamIdx < maxTeams; teamIdx++) {
        const teamId = teamIdx + 1;
        const count = counts[teamIdx];
        const teamTasks = sortedTasks.slice(startIdx, startIdx + count);
        teamTasks.forEach(task => {
            distributed.push({
                ...task,
                TeamID: teamId,
                Priority: getPriorityFromAction(task.Action)
            });
        });
        startIdx += count;
    }
    
    // إرسال المهام الموزعة إلى Apps Script
    try {
        const res = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'uploadTasks', tasks: distributed })
        });
        const result = await res.json();
        if (result.status === 'ok') {
            document.getElementById('distributeResult').innerHTML = `<span class="status-ok">✅ تم توزيع ${result.count} عداد على ${maxTeams} فرق</span>`;
            await loadAllTasksAndMarkers();
        } else {
            document.getElementById('distributeResult').innerHTML = `<span class="status-error">❌ خطأ: ${result.error}</span>`;
        }
    } catch (err) {
        document.getElementById('distributeResult').innerHTML = `<span class="status-error">خطأ في الاتصال: ${err.message}</span>`;
    }
});

function getPriorityFromAction(action) {
    const act = action.toString().trim();
    if (act === "فتح عداد") return 1;
    if (act === "قفل طلب عميل") return 2;
    if (act === "قفل عداد") return 3;
    if (act === "وضع ملصق") return 4;
    return 4;
}

async function loadAllTasksAndMarkers() {
    try {
        const res = await fetch(`${API_BASE}?action=getTasks`);
        const tasks = await res.json();
        const container = document.getElementById('tasksList');
        container.innerHTML = '';
        if (markersLayer) map.removeLayer(markersLayer);
        markersLayer = L.layerGroup().addTo(map);
        
        if (!tasks.length) {
            container.innerHTML = '<p>لا توجد مهام بعد</p>';
            return;
        }
        
        tasks.forEach(task => {
            const card = document.createElement('div');
            card.className = `task-item priority-${task.Priority}`;
            card.innerHTML = `
                <strong>عداد: ${task.MeterNumber}</strong> (الفريق ${task.TeamID})<br>
                الإجراء: ${task.Action} | الأولوية: ${task.Priority}<br>
                الموقع: (${task.Lat}, ${task.Lng})<br>
                الحالة: ${task.Status}<br>
                <button class="update-task" data-row="${task.row}" data-status="Done">✅ إنهاء</button>
            `;
            container.appendChild(card);
            
            const marker = L.marker([task.Lat, task.Lng]).addTo(markersLayer);
            const priorityColor = getPriorityColor(task.Priority);
            marker.bindPopup(`<b>عداد ${task.MeterNumber}</b><br>${task.Action}<br><span style="color:${priorityColor}">أولوية ${task.Priority}</span>`);
        });
        
        // إضافة مستمعات الأزرار
        document.querySelectorAll('.update-task').forEach(btn => {
            btn.addEventListener('click', async () => {
                await fetch(API_BASE, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ action: 'updateTaskStatus', row: parseInt(btn.dataset.row), Status: btn.dataset.status })
                });
                loadAllTasksAndMarkers();
            });
        });
    } catch (err) {
        console.error(err);
    }
}

function getPriorityColor(priority) {
    if (priority === 1) return '#e74c3c';
    if (priority === 2) return '#f39c12';
    if (priority === 3) return '#3498db';
    return '#2ecc71';
}

// بدء التشغيل
initMap();
loadZonesAndDraw(); // تحاول تحميل المناطق إن وجدت
