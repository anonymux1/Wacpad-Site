// Success page license loader and clipboard handler

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const isMock = params.get('mock');
  const customEmail = params.get('email');

  const loadingState = document.getElementById('loadingState');
  const contentState = document.getElementById('contentState');
  const errorState = document.getElementById('errorState');
  
  const customerEmailEl = document.getElementById('customerEmail');
  const licenseKeyInput = document.getElementById('licenseKeyInput');
  const copyBtn = document.getElementById('copyLicenseBtn');
  const errorMessageEl = document.getElementById('errorMessage');

  if (!sessionId) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    errorMessageEl.textContent = 'No session ID found in request. If you just purchased, please check your email for the license key.';
    return;
  }

  try {
    const url = `/api/get-license?session_id=${encodeURIComponent(sessionId)}${isMock ? '&mock=true' : ''}${customEmail ? `&email=${encodeURIComponent(customEmail)}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to retrieve license key');
    }

    loadingState.style.display = 'none';
    contentState.style.display = 'block';

    customerEmailEl.textContent = data.email || 'your email';
    licenseKeyInput.value = data.licenseKey;

    // Clipboard copy action
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.licenseKey);
        const prevText = copyBtn.innerHTML;
        copyBtn.innerHTML = '✓ Copied to Clipboard!';
        copyBtn.style.background = '#10b981';
        copyBtn.style.color = '#ffffff';

        setTimeout(() => {
          copyBtn.innerHTML = prevText;
          copyBtn.style.background = '';
          copyBtn.style.color = '';
        }, 3000);
      } catch (err) {
        licenseKeyInput.select();
        document.execCommand('copy');
        alert('Copied to clipboard!');
      }
    });

  } catch (err) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    errorMessageEl.textContent = err.message || 'An error occurred while issuing your license.';
  }
});
