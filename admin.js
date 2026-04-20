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

// قراءة ملف Excel باستخدام SheetJS
document.getElementById('readExcelBtn').addEventListener('click', () => {
    const file = document.getElementById('excelFile').files[0];
    if (!file) return alert('اختر ملف Excel أولاً');
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        if (rows.length < 2) return alert('الملف فارغ');
        const headers = rows[0];
        // نتوقع أعمدة: رقم العداد، خط العرض، خط الطول، الإجراء
        const meterIdx = headers.findIndex(h => h.includes('رقم') || h.includes('العداد'));
        const latIdx = headers.findIndex(h => h.includes('خط العرض') || h.includes('Lat'));
        const lngIdx = headers.findIndex(h => h.includes('خط الطول') || h.includes('Lng'));
        const actionIdx = headers.findIndex(h => h.includes('الإجراء') || h.includes('Action'));
        if (meterIdx === -1 || latIdx === -1 || lngIdx === -1 || actionIdx === -1) {
            alert('تأكد من وجود الأعمدة: رقم العداد، خط العرض، خط الطول، الإجراء');
            return;
        }
        rawTasks = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row[meterIdx]) continue;
            rawTasks.push({
                MeterNumber: row[meterIdx].toString(),
                Lat: parseFloat(row[latIdx]),
                Lng: parseFloat(row[lngIdx]),
                Action: row[actionIdx].toString().trim(),
                Notes: ""
            });
        }
        document.getElementById('excelPreview').innerHTML = `<p>✅ تم قراءة ${rawTasks.length} عداد</p>`;
        // عرض أول 5 عدادات
        let preview = '<ul>';
        rawTasks.slice(0,5).forEach(t => {
            preview += `<li>${t.MeterNumber} - (${t.Lat}, ${t.Lng}) - ${t.Action}</li>`;
        });
        preview += '</ul>';
        document.getElementById('excelPreview').innerHTML += preview;
    };
    reader.readAsArrayBuffer(file);
});

// رفع ملف KML إلى Apps Script
document.getElementById('uploadKmlBtn').addEventListener('click', async () => {
    const file = document.getElementById('kmlFile').files[0];
    if (!file) return alert('اختر ملف KML');
    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        const encoded = encodeURIComponent(content);
        const res = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'uploadZones', kmlContent: encoded })
        });
        const data = await res.json();
        document.getElementById('kmlStatus').innerHTML = `<span class="status-ok">✅ تم رفع ${data.zones} منطقة</span>`;
        loadZonesAndDraw();
    };
    reader.readAsText(file);
});

// تحميل المناطق من الـ Sheet ورسمها
async function loadZonesAndDraw() {
    const res = await fetch(`${API_BASE}?action=getZones`);
    zonesData = await res.json();
    if (zonesLayer) map.removeLayer(zonesLayer);
    zonesLayer = L.layerGroup().addTo(map);
    zonesData.forEach(zone => {
        const wkt = zone.PolygonWKT;
        if (wkt) {
            const coords = parseWKTToLeaflet(wkt);
            if (coords) {
                const color = getTeamColor(zone.TeamID);
                const polygon = L.polygon(coords, { color: color, weight: 2, fillOpacity: 0.2 }).addTo(zonesLayer);
                polygon.bindPopup(`الفريق ${zone.TeamID}<br>${zone.ZoneName}`);
            }
        }
    });
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

// إنشاء حقول إدخال عدد العدادات لكل فريق (حسب عدد المناطق الموجودة)
function buildTeamsCountInputs() {
    const container = document.getElementById('teamsCountInputs');
    container.innerHTML = '';
    const maxTeams = Math.min(zonesData.length, 5);
    if (maxTeams === 0) {
        container.innerHTML = '<p>يرجى رفع ملف المناطق أولاً</p>';
        return;
    }
    for (let i = 1; i <= maxTeams; i++) {
        const div = document.createElement('div');
        div.className = 'team-count';
        div.innerHTML = `<label>الفريق ${i}</label>
                         <input type="number" id="teamCount${i}" min="0" value="0" step="1">`;
        container.appendChild(div);
    }
}

document.getElementById('distributeBtn').addEventListener('click', async () => {
    if (rawTasks.length === 0) return alert('لم تقم بقراءة ملف Excel بعد');
    if (zonesData.length === 0) return alert('لم تقم برفع ملف المناطق');
    const maxTeams = zonesData.length;
    const counts = [];
    let totalNeeded = 0;
    for (let i = 1; i <= maxTeams; i++) {
        const val = parseInt(document.getElementById(`teamCount${i}`).value);
        if (isNaN(val)) return alert(`أدخل عدداً صحيحاً للفريق ${i}`);
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
    const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uploadTasks', tasks: distributed })
    });
    const result = await res.json();
    document.getElementById('distributeResult').innerHTML = `<span class="status-ok">✅ تم توزيع ${result.count} عداد على ${maxTeams} فرق</span>`;
    loadAllTasksAndMarkers();
});

function getPriorityFromAction(action) {
    switch(action) {
        case "فتح عداد": return 1;
        case "قفل طلب عميل": return 2;
        case "قفل عداد": return 3;
        case "وضع ملصق": return 4;
        default: return 4;
    }
}

async function loadAllTasksAndMarkers() {
    const res = await fetch(`${API_BASE}?action=getTasks`);
    const tasks = await res.json();
    const container = document.getElementById('tasksList');
    container.innerHTML = '';
    if (markersLayer) map.removeLayer(markersLayer);
    markersLayer = L.layerGroup().addTo(map);
    
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
        const popupColor = getPriorityColor(task.Priority);
        marker.bindPopup(`<b>عداد ${task.MeterNumber}</b><br>${task.Action}<br><span style="color:${popupColor}">أولوية ${task.Priority}</span>`);
    });
    
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
}

function getPriorityColor(priority) {
    if (priority === 1) return '#e74c3c';
    if (priority === 2) return '#f39c12';
    if (priority === 3) return '#3498db';
    return '#2ecc71';
}

// بدء التشغيل
initMap();
// بعد تحميل المناطق نضيف حقول الإدخال
setInterval(() => {
    if (zonesData.length > 0 && document.getElementById('teamsCountInputs').children.length === 0) {
        buildTeamsCountInputs();
    }
}, 1000);
loadZonesAndDraw();
