// Main interactive script for WacPad Landing Page

document.addEventListener('DOMContentLoaded', () => {
  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.getElementById('navLinks');
  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navLinks.classList.toggle('show');
      mobileMenuBtn.setAttribute('aria-expanded', navLinks.classList.contains('show'));
    });
    document.addEventListener('click', () => {
      navLinks.classList.remove('show');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    });
  }


  // Checkout button handler
  const checkoutBtn = document.getElementById('buyProBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const originalText = checkoutBtn.innerHTML;
      checkoutBtn.innerHTML = `<span>⏳ Preparing Checkout...</span>`;
      checkoutBtn.style.opacity = '0.75';
      checkoutBtn.style.pointerEvents = 'none';

      try {
        const res = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          throw new Error(data.error || 'Failed to initialize Stripe checkout');
        }
      } catch (err) {
        alert('Could not start checkout: ' + err.message);
        checkoutBtn.innerHTML = originalText;
        checkoutBtn.style.opacity = '1';
        checkoutBtn.style.pointerEvents = 'auto';
      }
    });
  }
});
