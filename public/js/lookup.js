/**
 * License recovery and device management client handler for WacPad.
 * Handles license key recovery via email and device management (viewing/deactivating seats).
 */
document.addEventListener('DOMContentLoaded', () => {
  // License Recovery Form Elements
  const form = document.getElementById('lookupForm');
  const emailInput = document.getElementById('lookupEmail');
  const submitBtn = document.getElementById('lookupSubmitBtn');
  const msgEl = document.getElementById('lookupMessage');

  // Key-based Device Management Elements
  const lookupKeyInput = document.getElementById('lookupKey');
  const lookupKeyBtn = document.getElementById('lookupKeyBtn');
  const deviceSection = document.getElementById('deviceManagementSection');
  const deviceList = document.getElementById('deviceList');
  const deviceCountBadge = document.getElementById('deviceCountBadge');
  const deviceStatusMsg = document.getElementById('deviceStatusMsg');

  let activeLicenseKey = '';

  /**
   * Shows a status message inside the device management section.
   *
   * @param {string} msg - Message text
   * @param {'success'|'error'} [type='success'] - Message type
   */
  function showDeviceStatus(msg, type = 'success') {
    if (!deviceStatusMsg) return;
    deviceStatusMsg.style.display = 'block';
    if (type === 'error') {
      deviceStatusMsg.style.background = 'rgba(239, 68, 68, 0.1)';
      deviceStatusMsg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      deviceStatusMsg.style.color = '#ef4444';
    } else {
      deviceStatusMsg.style.background = 'rgba(16, 185, 129, 0.1)';
      deviceStatusMsg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      deviceStatusMsg.style.color = '#10b981';
    }
    deviceStatusMsg.textContent = msg;
  }

  /**
   * Fetches active devices for a given license key and renders them.
   *
   * @param {string} licenseKey - WP1- license key
   */
  async function fetchDevices(licenseKey) {
    const key = (licenseKey || '').trim();
    if (!key) return;

    activeLicenseKey = key;
    if (deviceSection) deviceSection.style.display = 'block';
    if (deviceStatusMsg) deviceStatusMsg.style.display = 'none';
    if (deviceList) {
      deviceList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0;">Loading active devices...</div>';
    }

    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: key }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to retrieve active devices.');
      }

      renderDeviceList(data.devices || [], data.seats_used ?? 0, data.max_seats ?? 3);
    } catch (err) {
      if (deviceList) deviceList.innerHTML = '';
      showDeviceStatus(err.message || 'Error fetching active devices', 'error');
    }
  }

  /**
   * Renders the list of active device cards into the DOM.
   *
   * @param {Array<object>} devices - Array of active device objects
   * @param {number} seatsUsed - Current seats used
   * @param {number} maxSeats - Maximum seat capacity
   */
  function renderDeviceList(devices, seatsUsed, maxSeats) {
    if (!deviceList) return;
    deviceList.innerHTML = '';

    if (deviceCountBadge) {
      deviceCountBadge.textContent = `${seatsUsed} / ${maxSeats} Seats`;
    }

    if (!devices || devices.length === 0) {
      deviceList.innerHTML = `
        <div style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; text-align: center;">
          No active devices currently registered.
        </div>
      `;
      return;
    }

    devices.forEach((dev) => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--card-bg);
        border: 1px solid var(--card-border);
        border-radius: 8px;
        padding: 0.85rem 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      `;

      const infoCol = document.createElement('div');
      infoCol.style.cssText = 'display: flex; flex-direction: column; gap: 0.2rem;';

      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';

      // OS icon
      const iconSpan = document.createElement('span');
      const osLower = (dev.os || '').toLowerCase();
      iconSpan.textContent = osLower.includes('mac') ? '🍏' : (osLower.includes('win') ? '🪟' : '💻');
      titleRow.appendChild(iconSpan);

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-weight: 600; font-size: 0.95rem; color: var(--text-main);';
      nameSpan.textContent = dev.device_name || 'Desktop Workstation';
      titleRow.appendChild(nameSpan);

      infoCol.appendChild(titleRow);

      const metaRow = document.createElement('div');
      metaRow.style.cssText = 'font-size: 0.8rem; color: var(--text-muted);';
      const dateStr = dev.activated_at ? new Date(dev.activated_at * 1000).toLocaleDateString() : 'Active';
      metaRow.textContent = `${dev.os || 'Unknown OS'} • Activated ${dateStr}`;
      infoCol.appendChild(metaRow);

      // Deactivate button
      const deactBtn = document.createElement('button');
      deactBtn.type = 'button';
      deactBtn.className = 'btn btn-secondary';
      deactBtn.style.cssText = 'padding: 0.35rem 0.75rem; font-size: 0.8rem; color: var(--error); border-color: rgba(239, 68, 68, 0.4); white-space: nowrap;';
      deactBtn.textContent = 'Deactivate';

      deactBtn.addEventListener('click', async () => {
        if (!confirm(`Are you sure you want to deactivate "${dev.device_name || 'this computer'}"?`)) {
          return;
        }

        deactBtn.disabled = true;
        deactBtn.textContent = 'Deactivating...';

        try {
          const res = await fetch('/api/deactivate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              license_key: activeLicenseKey,
              machine_id: dev.machine_id,
            }),
          });
          const data = await res.json();

          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to deactivate machine.');
          }

          showDeviceStatus('Device successfully deactivated', 'success');
          // Refresh device list
          await fetchDevices(activeLicenseKey);
        } catch (err) {
          showDeviceStatus(err.message || 'Error deactivating device', 'error');
          deactBtn.disabled = false;
          deactBtn.textContent = 'Deactivate';
        }
      });

      card.appendChild(infoCol);
      card.appendChild(deactBtn);
      deviceList.appendChild(card);
    });
  }

  // Handle License Recovery Form Submit
  if (form && emailInput && submitBtn && msgEl) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) return;

      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Searching records...';
      msgEl.style.display = 'none';

      try {
        const res = await fetch('/api/lookup-license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to process license lookup.');
        }

        msgEl.style.display = 'block';
        msgEl.style.color = '#10b981';
        msgEl.textContent = data.message || 'If a purchase exists for this email, your license key has been sent to your inbox.';

        // After successful license lookup, also check if a key is available or in lookupKeyInput to query devices
        const keyToQuery = (lookupKeyInput ? lookupKeyInput.value.trim() : '') || activeLicenseKey;
        if (keyToQuery) {
          await fetchDevices(keyToQuery);
        }
      } catch (err) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#ef4444';
        msgEl.textContent = err.message || 'An unexpected error occurred. Please try again.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  // Handle direct License Key submission for device management
  if (lookupKeyBtn && lookupKeyInput) {
    lookupKeyBtn.addEventListener('click', () => {
      const key = lookupKeyInput.value.trim();
      if (!key) {
        showDeviceStatus('Please enter a valid WP1- license key', 'error');
        if (deviceSection) deviceSection.style.display = 'block';
        return;
      }
      fetchDevices(key);
    });

    lookupKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupKeyBtn.click();
      }
    });
  }

  // Check URL query parameters for ?key= or ?license_key= (e.g. from recovery email magic link)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const keyParam = urlParams.get('key') || urlParams.get('license_key');
    if (keyParam) {
      if (lookupKeyInput) lookupKeyInput.value = keyParam;
      fetchDevices(keyParam);
    }
  } catch (err) {
    console.debug('Failed to parse URL params for license key:', err);
  }
});
