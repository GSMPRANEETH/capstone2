// Password validation helpers based on OWASP guidelines

/**
 * Validates password strength according to OWASP guidelines
 * @param {string} password - The password to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validatePasswordStrength(password) {
    const errors = [];
    const minLength = 8;

    if (password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long.`);
    }

    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter.");
    }

    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter.");
    }

    if (!/[0-9]/.test(password)) {
        errors.push("Password must contain at least one number.");
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push("Password must contain at least one special character (!@#$%^&* etc.).");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Middleware to validate password strength
 * Expects password in req.body.password or req.body.newPassword
 */
function validatePasswordMiddleware(req, res, next) {
    const password = req.body.password || req.body.newPassword;
    
    if (!password) {
        req.flash('error', 'Password is required.');
        return res.redirect('back');
    }

    const validation = validatePasswordStrength(password);
    
    if (!validation.valid) {
        validation.errors.forEach(error => req.flash('error', error));
        return res.redirect('back');
    }

    next();
}

module.exports = {
    validatePasswordStrength,
    validatePasswordMiddleware
};
