'use strict';

const { Enrollments, Courses } = require('../models');

/**
 * Restrict route to educators only.
 */
function requireEducator(req, res, next) {
    if (req.user && req.user.role === 'educator') return next();
    return res.status(401).json({ message: 'Unauthorized user.' });
}

/**
 * Check if the logged-in educator owns a course (by courseId from params or provided id).
 * Sets req.course on success.
 */
async function requireCourseOwner(req, res, next) {
    try {
        const courseId = req.params.courseId || req.course?.id;
        const course = await Courses.findByPk(courseId);
        if (!course || course.creatorId !== req.user.id) {
            req.flash('error', 'Unauthorized');
            return res.redirect('/dashboard');
        }
        req.course = course;
        return next();
    } catch (err) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
}

/**
 * Check if the logged-in student is enrolled in a course (by courseId from params).
 * Sets req.enrollment on success.
 */
async function requireEnrollment(req, res, next) {
    try {
        const enrollment = await Enrollments.findOne({
            where: { userId: req.user.id, courseId: req.params.courseId }
        });
        if (!enrollment) {
            req.flash('error', 'You are not enrolled in this course.');
            return res.redirect('/dashboard');
        }
        req.enrollment = enrollment;
        return next();
    } catch (err) {
        req.flash('error', 'Could not verify enrollment.');
        return res.redirect('/dashboard');
    }
}

/**
 * OWASP password strength validation.
 * Returns an array of error strings (empty if password is valid).
 */
function validatePassword(password) {
    const errors = [];
    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long.');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter.');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter.');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one digit.');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Password must contain at least one special character.');
    }
    return errors;
}

module.exports = { requireEducator, requireCourseOwner, requireEnrollment, validatePassword };
