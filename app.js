// 🔁 All the imports (same as your current setup)
const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const csrf = require("csurf");
const connectEnsureLogin = require("connect-ensure-login");
const { Op } = require('sequelize');

const { User, Courses, Chapters, Pages, Enrollments, Completions, QuizQuestion, QuizAttempt } = require("./models");
const saltRounds = 10;

// 🔒 OWASP password strength validation
function validatePassword(password) {
    const errors = [];
    if (!password || password.length < 8) {
        errors.push("Password must be at least 8 characters long.");
    }
    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter.");
    }
    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter.");
    }
    if (!/[0-9]/.test(password)) {
        errors.push("Password must contain at least one digit.");
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push("Password must contain at least one special character.");
    }
    return errors;
}

// 📦 Middleware setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser("shh, some secret string!"));
app.use(csrf({ cookie: true }));

app.use(
    session({
        secret: "shh, some secret string!",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 },
    })
);

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// ✅ GLOBAL FLASH MIDDLEWARE
app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        res.status(403).send("Invalid CSRF token");
    } else {
        next(err);
    }
});

// 🔐 Passport strategy
passport.use(
    new LocalStrategy(
        { usernameField: "email" },
        async function (email, password, done) {
            try {
                const user = await User.findOne({ where: { email } });
                if (!user) return done(null, false, { message: "Incorrect email." });
                const isValid = await bcrypt.compare(password, user.password);
                if (!isValid) return done(null, false, { message: "Incorrect password." });
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    )
);

passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser(async (id, done) => {
    try { done(null, await User.findByPk(id)); }
    catch (err) { done(err); }
});

// 🔐 Middleware to restrict publisher-only access
function requirePublisher(req, res, next) {
    if (req.user && req.user.role === 'educator') return next();
    return res.status(401).json({ message: 'Unauthorized user.' });
}

// 🛣️ Routes
app.get("/", (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) return res.redirect("/dashboard");
    res.render("index");
});

app.get("/signup", (req, res) => {
    res.render("signup", { csrfToken: req.csrfToken() });
});

// Signup
app.post("/signup", async (req, res) => {
    try {
        // OWASP password strength validation
        const password = req.body.password;
        const passwordErrors = validatePassword(password);
        if (passwordErrors.length > 0) {
            req.flash("error", passwordErrors.join(" "));
            return res.redirect("/signup");
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
                req.flash("error", "Account created but login failed. Please sign in.");
                return res.redirect("/signin");
            }
            req.flash("success", "Account created successfully! Welcome.");
            return res.redirect("/dashboard");
        });
    } catch (error) {
        req.flash("error", "User creation failed. Check input and try again.");
        res.redirect("/signup");
    }
});

// Signin (handled by passport, but you can add a flash on GET if needed)
app.get("/signin", (req, res) => {
    res.render("signin", { csrfToken: req.csrfToken(), user: req.user });
});

app.post(
    "/signin",
    passport.authenticate("local", {
        successRedirect: "/dashboard",
        failureRedirect: "/signin",
        failureFlash: true,
    })
);

app.get("/dashboard", connectEnsureLogin.ensureLoggedIn("/signin"), async (req, res) => {
    try {
        const enrolledRows = await Enrollments.findAll({
            where: { userId: req.user.id },
            attributes: ['courseId']
        });
        const enrolledCourseIds = enrolledRows.map(row => row.courseId);
        const enrolledCourses = await Courses.findAll({ where: { id: enrolledCourseIds } });
        const availableCourses = await Courses.findAll({
            where: { id: { [Op.notIn]: enrolledCourseIds } }
        });
        res.render("dashboard", {
            user: req.user,
            csrfToken: req.csrfToken(),
            enrolledCourses,
            availableCourses,
        });
    } catch (error) {
        req.flash("error", "Could not load courses.");
        res.redirect("/");
    }
});

app.get("/signout", (req, res, next) => {
    req.logout(err => {
        if (err) {
            req.flash("error", "Sign out failed.");
            return next(err);
        }
        req.flash("success", "Signed out successfully.");
        res.redirect("/");
    });
});

app.get("/createnewcourse", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, (req, res) => {
    res.render("addcourse", { user: req.user, csrfToken: req.csrfToken() });
});

// Create course
app.post("/createnewcourse", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, async (req, res) => {
    try {
        const course = await Courses.create({
            name: req.body.name,
            creatorId: req.user.id,
        });
        req.flash("success", "Course created successfully.");
        res.redirect("/addchapters");
    } catch (error) {
        req.flash("error", "Course creation failed. Check input and try again.");
        res.redirect("/createnewcourse");
    }
});

app.get("/addchapters", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, async (req, res) => {
    let myCourses = await getCourse(req);
    res.render("addchapters", { myCourses: myCourses, user: req.user, csrfToken: req.csrfToken() });
});

app.post("/addchapters", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, async (req, res) => {
    try {
        const course = await Courses.findOne({ where: { name: req.body.courseName } });
        if (!course) throw new Error("Course not found");
        await Chapters.create({
            name: req.body.chapterName,
            description: req.body.description,
            courseId: course.id,
        });
        req.flash("success", "Chapter created successfully.");
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash("error", "Chapter creation failed.");
        res.redirect("/addchapters");
    }
});

app.get("/addpages", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, async (req, res) => {
    try {
        const courseId = req.query.courseId;
        const myChapters = await Chapters.findAll({
            where: { courseId },
            include: [{ model: Pages }]
        });
        res.render("addpages", {
            user: req.user,
            csrfToken: req.csrfToken(),
            myChapters: myChapters,
            courseId: courseId,
        });
    } catch (error) {
        req.flash("error", "Missing or invalid course.");
        res.redirect("/dashboard");
    }
});

app.post("/addpages", connectEnsureLogin.ensureLoggedIn("/signin"), requirePublisher, async (req, res) => {
    try {
        const courseId = req.body.courseId;
        const chapterId = req.body.chapterId;
        const title = req.body.title;
        const content = req.body.content;
        if (!courseId || !chapterId || !title || !content) {
            throw new Error("Missing required fields");
        }
        await Pages.create({
            title: title,
            content: content,
            chapterId: chapterId,
        });
        req.flash("success", "Page created successfully.");
        return res.redirect(`/courses/${courseId}`);
    } catch (error) {
        req.flash("error", "Page creation failed.");
        return res.redirect(`/addpages?courseId=${req.body.courseId || ''}`);
    }
});

// Show update password form
app.get('/update-password', connectEnsureLogin.ensureLoggedIn('/signin'), (req, res) => {
    res.render('update-password', { csrfToken: req.csrfToken(), user: req.user });
});

// Handle update password form submission
app.post('/update-password', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findByPk(req.user.id);
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
        req.flash('error', 'Old password incorrect');
        return res.redirect('/update-password');
    }
    user.password = await bcrypt.hash(newPassword, saltRounds);
    await user.save();
    req.flash('success', 'Password updated');
    res.redirect('/dashboard');
});

// Enroll in a course
app.post('/enroll/:courseId', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    try {
        // Prevent duplicate enrollments
        const [enrollment, created] = await Enrollments.findOrCreate({
            where: { userId: req.user.id, courseId: req.params.courseId }
        });
        if (created) {
            req.flash('success', 'Enrolled successfully!');
        } else {
            req.flash('info', 'You are already enrolled in this course.');
        }
        res.redirect('/dashboard');
    } catch (error) {
        req.flash('error', 'Could not enroll in course.');
        res.redirect('/dashboard');
    }
});

// Show a specific page
app.get('/pages/:pageId', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    try {
        const page = await Pages.findByPk(req.params.pageId, {
            include: [{ model: Chapters }]
        });
        if (!page) {
            req.flash('error', 'Page not found');
            return res.redirect('back');
        }
        const chapter = page.Chapter;
        const course = await Courses.findByPk(chapter.courseId);

        // Only allow educator (creator) or enrolled student
        let allowed = false;
        if (req.user.role === 'educator' && course.creatorId === req.user.id) {
            allowed = true;
        } else if (req.user.role === 'student') {
            const enrollment = await Enrollments.findOne({
                where: { userId: req.user.id, courseId: course.id }
            });
            allowed = !!enrollment;
        }
        if (!allowed) {
            req.flash('error', 'You are not authorized to view this page.');
            return res.redirect('/dashboard');
        }

        // Fetch all pages in the chapter for prev/next navigation
        const chapterPages = await Pages.findAll({
            where: { chapterId: chapter.id },
            order: [['id', 'ASC']]
        });
        const pageIndex = chapterPages.findIndex(p => p.id === page.id);
        const prevPage = pageIndex > 0 ? chapterPages[pageIndex - 1] : null;
        const nextPage = pageIndex < chapterPages.length - 1 ? chapterPages[pageIndex + 1] : null;

        res.render('page', {
            user: req.user,
            csrfToken: req.csrfToken(),
            page,
            chapter,
            course,
            prevPage,
            nextPage,
            isCompleted: !!await Completions.findOne({ where: { userId: req.user.id, pageId: page.id } })
        });
    } catch (error) {
        req.flash('error', 'Could not load page.');
        res.redirect('back');
    }
});

// Mark page as complete
app.post('/pages/:pageId/complete', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    try {
        const pageId = req.params.pageId;
        const userId = req.user.id;
        await Completions.findOrCreate({ where: { userId, pageId } });
        req.flash('success', 'Page marked as complete!');
        res.redirect(`/pages/${pageId}`);
    } catch (error) {
        req.flash('error', 'Could not mark as complete.');
        res.redirect(`/pages/${req.params.pageId}`);
    }
});

// Edit course form
app.get('/courses/:courseId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const course = await Courses.findByPk(req.params.courseId);
    if (!course || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    res.render('editcourse', { user: req.user, course, csrfToken: req.csrfToken() });
});

// Edit course
app.post('/courses/:courseId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const course = await Courses.findByPk(req.params.courseId);
    if (!course || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    course.name = req.body.name;
    await course.save();
    req.flash('success', 'Course updated!');
    res.redirect(`/courses/${course.id}`);
});

// Delete course
app.post('/courses/:courseId/delete', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const course = await Courses.findByPk(req.params.courseId);
    if (!course || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    await course.destroy();
    req.flash('success', 'Course deleted!');
    res.redirect('/dashboard');
});

// Add chapter (already exists as POST /addchapters)

// Edit chapter form
app.get('/chapters/:chapterId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const chapter = await Chapters.findByPk(req.params.chapterId);
    const course = await Courses.findByPk(chapter.courseId);
    if (!chapter || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    res.render('editchapter', { user: req.user, chapter, csrfToken: req.csrfToken() });
});

// Handle edit chapter
app.post('/chapters/:chapterId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const chapter = await Chapters.findByPk(req.params.chapterId);
    const course = await Courses.findByPk(chapter.courseId);
    if (!chapter || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    chapter.name = req.body.name;
    chapter.description = req.body.description;
    await chapter.save();
    req.flash('success', 'Chapter updated!');
    res.redirect(`/courses/${course.id}`);
});

// Delete chapter
app.post('/chapters/:chapterId/delete', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const chapter = await Chapters.findByPk(req.params.chapterId);
    const course = await Courses.findByPk(chapter.courseId);
    if (!chapter || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    await chapter.destroy();
    req.flash('success', 'Chapter deleted!');
    res.redirect(`/courses/${course.id}`);
});

// Add page (already exists as POST /addpages)

// Edit page form
app.get('/pages/:pageId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const page = await Pages.findByPk(req.params.pageId, { include: [{ model: Chapters }] });
    const chapter = page.Chapter;
    const course = await Courses.findByPk(chapter.courseId);
    if (!page || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    res.render('editpage', { user: req.user, page, chapter, csrfToken: req.csrfToken() });
});

// Handle edit page
app.post('/pages/:pageId/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const page = await Pages.findByPk(req.params.pageId, { include: [{ model: Chapters }] });
    const chapter = page.Chapter;
    const course = await Courses.findByPk(chapter.courseId);
    if (!page || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    page.title = req.body.title;
    page.content = req.body.content;
    await page.save();
    req.flash('success', 'Page updated!');
    res.redirect(`/courses/${course.id}`);
});

// Delete page
app.post('/pages/:pageId/delete', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const page = await Pages.findByPk(req.params.pageId, { include: [{ model: Chapters }] });
    const chapter = page.Chapter;
    const course = await Courses.findByPk(chapter.courseId);
    if (!page || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    await page.destroy();
    req.flash('success', 'Page deleted!');
    res.redirect(`/courses/${course.id}`);
});

// Show add quiz question form
app.get('/chapters/:chapterId/quiz/add', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    res.render('addquizquestion', { chapterId: req.params.chapterId, csrfToken: req.csrfToken(), user: req.user });
});

// Handle add quiz question
app.post('/chapters/:chapterId/quiz/add', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    await QuizQuestion.create({
        chapterId: req.params.chapterId,
        question: req.body.question,
        answer: req.body.answer
    });
    req.flash('success', 'Quiz question added!');
    res.redirect(`/chapters/${req.params.chapterId}/quiz/edit`);
});

// (Optional) Delete quiz question
app.post('/quizquestion/:id/delete', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const qq = await QuizQuestion.findByPk(req.params.id);
    if (qq) await qq.destroy();
    req.flash('success', 'Quiz question deleted!');
    res.redirect('/chapters/' + qq.chapterId + '/quiz/edit');
});

// Quiz route
app.get('/chapters/:chapterId/quiz', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    const chapterId = req.params.chapterId;
    const questions = await QuizQuestion.findAll({ where: { chapterId } });
    let courseId;
    if (!questions.length) {
        // Need to get courseId for redirect
        const chapter = await Chapters.findByPk(chapterId);
        courseId = chapter ? chapter.courseId : undefined;
        req.flash('info', 'No quiz for this chapter.');
        return res.redirect('/courses/' + (courseId || ''));
    }
    const chapter = await Chapters.findByPk(chapterId);
    if (!chapter) {
        req.flash('error', 'Chapter not found.');
        return res.redirect('/dashboard');
    }
    courseId = chapter.courseId;
    const attempt = await QuizAttempt.findOne({ where: { userId: req.user.id, chapterId } });
    let showAnswers = false;
    let passed = false;
    if (attempt) {
        passed = attempt.score !== null && attempt.score === attempt.total;
        if (attempt.attempts >= 3 || passed) {
            showAnswers = true;
        }
    }
    res.render('quiz', {
        questions,
        chapterId,
        courseId,
        csrfToken: req.csrfToken(),
        user: req.user,
        attempt,
        showAnswers,
        passed
    });
});

// Handle quiz submission
app.post('/chapters/:chapterId/quiz', connectEnsureLogin.ensureLoggedIn('/signin'), async (req, res) => {
    const chapterId = req.params.chapterId;
    const userId = req.user.id;
    const questions = await QuizQuestion.findAll({ where: { chapterId } });

    let [attempt, created] = await QuizAttempt.findOrCreate({
        where: { userId, chapterId },
        defaults: { score: 0, total: questions.length, attempts: 0 }
    });

    if (attempt.attempts >= 3 || attempt.score === attempt.total) {
        req.flash('error', 'No more attempts allowed. Correct answers are now shown.');
        return res.redirect(`/chapters/${chapterId}/quiz`);
    }

    let score = 0;
    let wrongAnswers = [];
    questions.forEach(q => {
        const userAnswer = (req.body[`q${q.id}`] || '').trim().toLowerCase();
        const correctAnswer = (q.answer || '').trim().toLowerCase();
        if (userAnswer === correctAnswer) {
            score++;
        } else {
            wrongAnswers.push({ question: q.question, correct: q.answer });
        }
    });

    attempt.attempts = (attempt.attempts || 0) + 1;
    attempt.score = score;
    attempt.total = questions.length;
    await attempt.save();

    if (score === questions.length) {
        req.flash('success', `Quiz submitted! All answers correct! Your score: ${score}/${questions.length}`);
    } else if (attempt.attempts >= 3) {
        let answerList = wrongAnswers.map(w => `<li><strong>${w.question}</strong>: ${w.correct}</li>`).join('');
        req.flash('error', `You have reached 3 attempts. Correct answers:<ul>${answerList}</ul>`);
    } else {
        req.flash('error', `Quiz submitted! Your score: ${score}/${questions.length}. You have ${3 - attempt.attempts} attempt(s) left.`);
    }

    // SAFELY get the chapter and course
    const chapter = await Chapters.findByPk(chapterId);
    if (!chapter) {
        req.flash('error', 'Chapter not found.');
        return res.redirect('/dashboard');
    }
    const courseId = chapter.courseId;
    if (!courseId) {
        req.flash('error', 'Course not found.');
        return res.redirect('/dashboard');
    }
    res.redirect(`/chapters/${chapterId}/quiz`);
});

// Edit quiz page (list, add, delete questions)
app.get('/chapters/:chapterId/quiz/edit', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    const questions = await QuizQuestion.findAll({ where: { chapterId: req.params.chapterId } });
    res.render('editquiz', { questions, chapterId: req.params.chapterId, courseId: (await Chapters.findByPk(req.params.chapterId)).courseId, csrfToken: req.csrfToken(), user: req.user });
});

// 📦 Helper functions
async function getCourse(req) {
    return await Courses.findAll({ where: { creatorId: req.user.id } });
}

async function getChapters(req, cId) {
    const courseId = cId || req.query.courseId;
    if (!courseId) throw new Error("Missing courseId in query");
    return await Chapters.findAll({ where: { courseId } });
}

app.get("/mycourses", connectEnsureLogin.ensureLoggedIn("/signin"), async (req, res) => {
    let myCourses = await getCourse(req);
    res.render("mycourses", { user: req.user, csrfToken: req.csrfToken(), myCourses: myCourses });
});

// Route to view a specific course and its chapters
app.get("/courses/:courseId", connectEnsureLogin.ensureLoggedIn("/signin"), async (req, res) => {
    const courseId = req.params.courseId;
    const course = await Courses.findByPk(courseId);
    if (!course) return res.status(404).send("Course not found");

    const myChapters = await Chapters.findAll({
        where: { courseId },
        include: [{ model: Pages }]
    });

    const isEducator = req.user.role === 'educator' && course.creatorId === req.user.id;
    let isEnrolled = false;
    let completedPageIds = [];
    let progress = 0;

    if (req.user.role === 'student') {
        const enrollment = await Enrollments.findOne({
            where: { userId: req.user.id, courseId }
        });

        isEnrolled = !!enrollment;

        if (isEnrolled) {
            // Fetch all completions for this user
            const allCompletions = await Completions.findAll({
                where: { userId: req.user.id }
            });
            completedPageIds = allCompletions.map(c => c.pageId);

            // Fetch quiz attempts for this user
            const quizAttempts = await QuizAttempt.findAll({
                where: { userId: req.user.id }
            });

            // Compute chapter-level progress
            let totalChapterProgress = 0;

            for (const chapter of myChapters) {
                const pages = chapter.Pages || [];
                const numPages = pages.length;
                const quizExists = await QuizQuestion.findOne({ where: { chapterId: chapter.id } });

                const totalItems = numPages + (quizExists ? 1 : 0);
                if (totalItems === 0) continue; // Avoid division by zero

                let completedCount = 0;

                // Count completed pages
                for (const page of pages) {
                    if (completedPageIds.includes(page.id)) completedCount++;
                }

                // Count passed quiz
                if (quizExists) {
                    const quizAttempt = quizAttempts.find(a =>
                        a.chapterId === chapter.id &&
                        a.score === a.total
                    );
                    if (quizAttempt) completedCount++;
                }

                const chapterProgress = (completedCount / totalItems) * 100;
                totalChapterProgress += chapterProgress;
            }

            progress = myChapters.length > 0
                ? Math.round(totalChapterProgress / myChapters.length)
                : 0;
        }
    }

    res.render("course", {
        user: req.user,
        csrfToken: req.csrfToken(),
        myChapters,
        course,
        isEducator,
        isEnrolled,
        progress,
        completedPageIds
    });
});



// Reports
app.get('/reports', connectEnsureLogin.ensureLoggedIn('/signin'), requirePublisher, async (req, res) => {
    try {
        const courses = await Courses.findAll({ where: { creatorId: req.user.id } });
        const reports = await Promise.all(
            courses.map(async course => {
                const count = await Enrollments.count({ where: { courseId: course.id } });
                return { course, count };
            })
        );
        res.render('reports', { user: req.user, reports, csrfToken: req.csrfToken() });
    } catch (error) {
        req.flash("error", "Could not load reports.");
        res.redirect('/dashboard');
    }
});


module.exports = app;
