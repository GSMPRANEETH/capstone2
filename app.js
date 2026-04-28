'use strict';

const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const csrf = require('csurf');

const { User } = require('./models');

// ─── Environment Variable Validation ─────────────────────────────────────────

if (!process.env.COOKIE_SECRET) {
    console.error('FATAL ERROR: COOKIE_SECRET environment variable is not set.');
    process.exit(1);
}

// ─── View Engine ─────────────────────────────────────────────────────────────

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Body / Cookie Parsing ────────────────────────────────────────────────────

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(csrf({ cookie: true }));

// ─── Session ─────────────────────────────────────────────────────────────────

app.use(
    session({
        secret: process.env.COOKIE_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        },
    })
);

// ─── Passport ────────────────────────────────────────────────────────────────

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

passport.use(
    new LocalStrategy(
        { usernameField: 'email' },
        async function (email, password, done) {
            try {
                const user = await User.findOne({ where: { email } });
                if (!user) return done(null, false, { message: 'Incorrect email.' });
                const isValid = await bcrypt.compare(password, user.password);
                if (!isValid) return done(null, false, { message: 'Incorrect password.' });
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
    try {
        done(null, await User.findByPk(id));
    } catch (err) {
        done(err);
    }
});

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');

app.use('/', authRoutes);
app.use('/', courseRoutes);

// ─── CSRF Error Handler ───────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        res.status(403).send('Invalid CSRF token');
    } else {
        next(err);
    }
});

module.exports = app;
