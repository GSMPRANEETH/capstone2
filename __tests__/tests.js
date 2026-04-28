const request = require('supertest');
const app = require('../app');
const { validatePassword } = require('../middleware/auth');

// ─── Password Validation Unit Tests ──────────────────────────────────────────

describe('validatePassword', () => {
    test('accepts a strong password', () => {
        expect(validatePassword('Secure@123')).toHaveLength(0);
    });

    test('rejects password shorter than 8 characters', () => {
        const errors = validatePassword('Ab1!');
        expect(errors.some(e => e.includes('8 characters'))).toBe(true);
    });

    test('rejects password without uppercase letter', () => {
        const errors = validatePassword('secure@123');
        expect(errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    test('rejects password without lowercase letter', () => {
        const errors = validatePassword('SECURE@123');
        expect(errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    test('rejects password without digit', () => {
        const errors = validatePassword('Secure@abc');
        expect(errors.some(e => e.includes('digit'))).toBe(true);
    });

    test('rejects password without special character', () => {
        const errors = validatePassword('Secure123');
        expect(errors.some(e => e.includes('special character'))).toBe(true);
    });

    test('rejects empty password', () => {
        const errors = validatePassword('');
        expect(errors.length).toBeGreaterThan(0);
    });

    test('returns multiple errors for a very weak password', () => {
        const errors = validatePassword('weak');
        expect(errors.length).toBeGreaterThan(1);
    });
});

// ─── Basic Route Tests ────────────────────────────────────────────────────────

describe('Basic LMS Route Tests', () => {
    test('GET / responds with 200 or 302', async () => {
        const res = await request(app).get('/');
        expect([200, 302]).toContain(res.statusCode);
    });

    test('GET /signin responds with 200', async () => {
        const res = await request(app).get('/signin');
        expect(res.statusCode).toBe(200);
    });

    test('GET /signup responds with 200', async () => {
        const res = await request(app).get('/signup');
        expect(res.statusCode).toBe(200);
    });

    test('GET /dashboard redirects if not signed in', async () => {
        const res = await request(app).get('/dashboard');
        expect([302, 401, 403]).toContain(res.statusCode);
    });

    test('GET /nonexistent returns 404', async () => {
        const res = await request(app).get('/thispagedoesnotexist');
        expect(res.statusCode).toBe(404);
    });
});

// ─── Protected Route Redirect Tests ──────────────────────────────────────────

describe('Protected routes redirect unauthenticated users', () => {
    const protectedRoutes = [
        '/mycourses',
        '/createnewcourse',
        '/addchapters',
        '/addpages',
        '/update-password',
        '/reports',
    ];

    protectedRoutes.forEach(route => {
        test(`GET ${route} redirects to /signin`, async () => {
            const res = await request(app).get(route);
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toMatch(/signin/);
        });
    });
});

// ─── Signup Route Tests ───────────────────────────────────────────────────────

describe('POST /signup with weak password', () => {
    test('redirects back to /signup when password is too weak', async () => {
        const agent = request.agent(app);

        // Step 1: GET /signup to obtain CSRF token cookie
        const getRes = await agent.get('/signup');
        expect(getRes.statusCode).toBe(200);

        // Extract CSRF token from the HTML response body
        const csrfMatch = getRes.text.match(/name="_csrf"\s+value="([^"]+)"/);
        expect(csrfMatch).not.toBeNull();
        const csrfToken = csrfMatch[1];

        // Step 2: POST with weak password
        const postRes = await agent
            .post('/signup')
            .type('form')
            .send({
                _csrf: csrfToken,
                firstName: 'Test',
                lastName: 'User',
                email: 'test@example.com',
                role: 'student',
                password: 'weak',
            });

        // Should redirect back to /signup due to password validation failure
        expect(postRes.statusCode).toBe(302);
        expect(postRes.headers.location).toMatch(/signup/);
    });
});

// ─── Signin Route Tests ───────────────────────────────────────────────────────

describe('POST /signin with wrong credentials', () => {
    test('does not succeed (redirects to /signin or errors) on bad credentials', async () => {
        const agent = request.agent(app);

        const getRes = await agent.get('/signin');
        const csrfMatch = getRes.text.match(/name="_csrf"\s+value="([^"]+)"/);
        expect(csrfMatch).not.toBeNull();
        const csrfToken = csrfMatch[1];

        const postRes = await agent
            .post('/signin')
            .type('form')
            .send({
                _csrf: csrfToken,
                email: 'nonexistent@example.com',
                password: 'WrongPass@1',
            });

        // Either a redirect away from dashboard (302 to /signin) or a server error
        // when no DB is available — never a 200 success landing on the dashboard.
        expect(postRes.statusCode).not.toBe(200);
        if (postRes.statusCode === 302) {
            expect(postRes.headers.location).not.toMatch(/dashboard/);
        }
    });
});

