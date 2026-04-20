const urlParams = new URLSearchParams(window.location.search);
const teamId = urlParams.get("team");
if (!teamId || teamId < 1 || teamId > 5) {
    document.body.innerHTML = "<h2>رابط غير صالح. استخدم ?team=1 إلى 5</h2>";
} else {
    document.getElementById("teamNumber").innerText = teamId;
    initTeamMap();
    loadTeamTasks();
}

let map;
let markersLayer;

function initTeamMap() {
    map = L.map('map').setView([24.7136, 46.6753], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);
}

async function loadTeamTasks() {
    const res = await fetch(`${API_BASE}?action=getTasks&team=${teamId}`);
    const tasks = await res.json();
    const container = document.getElementById('tasksList');
    container.innerHTML = '';
    if (markersLayer) map.removeLayer(markersLayer);
    markersLayer = L.layerGroup().addTo(map);
    
    tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = `task-card priority-${task.Priority}`;
        card.innerHTML = `
            <strong>عداد: ${task.MeterNumber}</strong><br>
            الإجراء: ${task.Action} | الأولوية: ${task.Priority}<br>
            الموقع: (${task.Lat}, ${task.Lng})<br>
            الحالة: ${task.Status}<br>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${task.Lat},${task.Lng}" target="_blank">🗺️ فتح الخريطة</a><br>
            <button class="btn-start" data-row="${task.row}">▶️ بدء التنفيذ</button>
            <button class="btn-done" data-row="${task.row}">✔️ إنهاء</button>
        `;
        container.appendChild(card);
        
        const marker = L.marker([task.Lat, task.Lng]).addTo(markersLayer);
        const priorityColor = task.Priority === 1 ? '#e74c3c' : (task.Priority === 2 ? '#f39c12' : (task.Priority === 3 ? '#3498db' : '#2ecc71'));
        marker.bindPopup(`<b>عداد ${task.MeterNumber}</b><br>${task.Action}<br><span style="color:${priorityColor}">أولوية ${task.Priority}</span>`);
    });
    
    document.querySelectorAll('.btn-start').forEach(btn => {
        btn.addEventListener('click', async () => {
            await updateStatus(btn.dataset.row, "InProgress");
            loadTeamTasks();
        });
    });
    document.querySelectorAll('.btn-done').forEach(btn => {
        btn.addEventListener('click', async () => {
            await updateStatus(btn.dataset.row, "Done");
            loadTeamTasks();
        });
    });
}

async function updateStatus(row, status) {
    await fetch(API_BASE, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateTaskStatus", row: parseInt(row), Status: status })
    });
}
