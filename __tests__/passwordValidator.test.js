const { validatePasswordStrength } = require('../helpers/passwordValidator');

describe('Password Validation Tests', () => {
    test('Valid password passes all checks', () => {
        const result = validatePasswordStrength('SecurePass123!');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('Password without uppercase fails', () => {
        const result = validatePasswordStrength('securepass123!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter.');
    });

    test('Password without lowercase fails', () => {
        const result = validatePasswordStrength('SECUREPASS123!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter.');
    });

    test('Password without number fails', () => {
        const result = validatePasswordStrength('SecurePass!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number.');
    });

    test('Password without special character fails', () => {
        const result = validatePasswordStrength('SecurePass123');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one special character (!@#$%^&* etc.).');
    });

    test('Password too short fails', () => {
        const result = validatePasswordStrength('Pass1!');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long.');
    });

    test('Multiple validation errors reported', () => {
        const result = validatePasswordStrength('pass');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
    });
});
