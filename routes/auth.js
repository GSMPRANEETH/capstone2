'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('passport');
const connectEnsureLogin = require('connect-ensure-login');
const { User, Courses, Enrollments } = require('../models');
const { Op } = require('sequelize');
const { validatePassword } = require('../middleware/auth');

const saltRounds = 10;

// Home
router.get('/', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('index');
});

// Signup form
router.get('/signup', (req, res) => {
    res.render('signup', { csrfToken: req.csrfToken() });
});

// Signup submit
router.post('/signup', async (req, res) => {
    try {
        const password = req.body.password;
        const passwordErrors = validatePassword(password);
        if (passwordErrors.length > 0) {
            req.flash('error', passwordErrors.join(' '));
            return res.redirect('/signup');
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const user = await User.create({
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            role: req.body.role,
            password: hashedPassword,
        });
        // Auto-login after signup
        req.login(user, (err) => {
            if (err) {
                req.flash('error', 'Account created but login failed. Please sign in.');
                return res.redirect('/signin');
            }
            req.flash('success', 'Account created successfully! Welcome.');
            return res.redirect('/dashboard');
        });
    } catch (error) {
        req.flash('error', 'User creation failed. Check input and try again.');
        res.redirect('/signup');
    }
});

// Signin form
router.get('/signin', (req, res) => {
    res.render('signin', { csrfToken: req.csrfToken(), user: req.user });
});

// Signin submit
router.post(
    '/signin',
    passport.authenticate('local', {
        successRedirect: '/dashboard',
        failureRedirect: '/signin',
        failureFlash: true,
    })
);

// Dashboard
router.get('/dashboard', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    try {
        const enrolledRows = await Enrollments.findAll({
            where: { userId: req.user.id },
            attributes: ['courseId'],
        });
        const enrolledCourseIds = enrolledRows.map((row) => row.courseId);
        const enrolledCourses = await Courses.findAll({ where: { id: enrolledCourseIds } });
        const availableCourses = await Courses.findAll({
            where: { id: { [Op.notIn]: enrolledCourseIds } },
        });
        res.render('dashboard', {
            user: req.user,
            csrfToken: req.csrfToken(),
            enrolledCourses,
            availableCourses,
        });
    } catch (error) {
        req.flash('error', 'Could not load courses.');
        res.redirect('/');
    }
});

// Sign out
router.get('/signout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            req.flash('error', 'Sign out failed.');
            return next(err);
        }
        req.flash('success', 'Signed out successfully.');
        res.redirect('/');
    });
});

// Update password form
router.get('/update-password', connectEnsureLogin.ensureLoggedIn('/signin'), (req, res) => {
    res.render('update-password', { csrfToken: req.csrfToken(), user: req.user });
});

// Update password submit
router.post('/update-password', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findByPk(req.user.id);
        const valid = await bcrypt.compare(oldPassword, user.password);
        if (!valid) {
            req.flash('error', 'Old password incorrect');
            return res.redirect('/update-password');
        }
        const passwordErrors = validatePassword(newPassword);
        if (passwordErrors.length > 0) {
            req.flash('error', passwordErrors.join(' '));
            return res.redirect('/update-password');
        }
        user.password = await bcrypt.hash(newPassword, saltRounds);
        await user.save();
        req.flash('success', 'Password updated');
        res.redirect('/dashboard');
    } catch (error) {
        req.flash('error', 'Password update failed.');
        res.redirect('/update-password');
    }
});

module.exports = router;
