'use strict';

const express = require('express');
const router = express.Router();
const connectEnsureLogin = require('connect-ensure-login');
const { Courses, Chapters, Pages, Enrollments, Completions, QuizQuestion, QuizAttempt } = require('../models');
const { requireEducator } = require('../middleware/auth');

const ensureLoggedIn = connectEnsureLogin.ensureLoggedIn('/signin');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getEducatorCourses(userId) {
    return Courses.findAll({ where: { creatorId: userId } });
}

/**
 * Load a chapter and verify the logged-in educator owns the parent course.
 * Returns { chapter, course } or throws.
 */
async function loadChapterForEducator(chapterId, userId) {
    const chapter = await Chapters.findByPk(chapterId);
    if (!chapter) {
        const err = new Error('Chapter not found');
        err.status = 404;
        throw err;
    }
    const course = await Courses.findByPk(chapter.courseId);
    if (!course || course.creatorId !== userId) {
        const err = new Error('Unauthorized');
        err.status = 403;
        throw err;
    }
    return { chapter, course };
}

/**
 * Load a page (with its Chapter) and verify the logged-in educator owns the course.
 * Returns { page, chapter, course } or throws.
 */
async function loadPageForEducator(pageId, userId) {
    const page = await Pages.findByPk(pageId, { include: [{ model: Chapters }] });
    if (!page) {
        const err = new Error('Page not found');
        err.status = 404;
        throw err;
    }
    const chapter = page.Chapter;
    const course = await Courses.findByPk(chapter.courseId);
    if (!course || course.creatorId !== userId) {
        const err = new Error('Unauthorized');
        err.status = 403;
        throw err;
    }
    return { page, chapter, course };
}

// ─── My Courses (educator) ───────────────────────────────────────────────────

router.get('/mycourses', ensureLoggedIn, async (req, res) => {
    const myCourses = await getEducatorCourses(req.user.id);
    res.render('mycourses', { user: req.user, csrfToken: req.csrfToken(), myCourses });
});

// ─── Create Course ───────────────────────────────────────────────────────────

router.get('/createnewcourse', ensureLoggedIn, requireEducator, (req, res) => {
    res.render('addcourse', { user: req.user, csrfToken: req.csrfToken() });
});

router.post('/createnewcourse', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const course = await Courses.create({
            name: req.body.name,
            creatorId: req.user.id,
        });
        req.flash('success', 'Course created successfully.');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', 'Course creation failed. Check input and try again.');
        res.redirect('/createnewcourse');
    }
});

// ─── View Course ─────────────────────────────────────────────────────────────

router.get('/courses/:courseId', ensureLoggedIn, async (req, res) => {
    try {
        const courseId = req.params.courseId;
        const course = await Courses.findByPk(courseId);
        if (!course) return res.status(404).send('Course not found');

        const myChapters = await Chapters.findAll({
            where: { courseId },
            include: [{ model: Pages }],
        });

        const isEducator = req.user.role === 'educator' && course.creatorId === req.user.id;
        let isEnrolled = false;
        let completedPageIds = [];
        let progress = 0;

        if (req.user.role === 'student') {
            const enrollment = await Enrollments.findOne({
                where: { userId: req.user.id, courseId },
            });
            isEnrolled = !!enrollment;

            if (isEnrolled) {
                const allCompletions = await Completions.findAll({
                    where: { userId: req.user.id },
                });
                completedPageIds = allCompletions.map((c) => c.pageId);

                const quizAttempts = await QuizAttempt.findAll({
                    where: { userId: req.user.id },
                });

                let totalChapterProgress = 0;
                for (const chapter of myChapters) {
                    const pages = chapter.Pages || [];
                    const quizExists = await QuizQuestion.findOne({ where: { chapterId: chapter.id } });
                    const totalItems = pages.length + (quizExists ? 1 : 0);
                    if (totalItems === 0) continue;

                    let completedCount = pages.filter((p) => completedPageIds.includes(p.id)).length;
                    if (quizExists) {
                        const passed = quizAttempts.find(
                            (a) => a.chapterId === chapter.id && a.score === a.total
                        );
                        if (passed) completedCount++;
                    }
                    totalChapterProgress += (completedCount / totalItems) * 100;
                }

                progress =
                    myChapters.length > 0
                        ? Math.round(totalChapterProgress / myChapters.length)
                        : 0;
            }
        }

        res.render('course', {
            user: req.user,
            csrfToken: req.csrfToken(),
            myChapters,
            course,
            isEducator,
            isEnrolled,
            progress,
            completedPageIds,
        });
    } catch (error) {
        req.flash('error', 'Could not load course.');
        res.redirect('/dashboard');
    }
});

// ─── Edit / Delete Course ────────────────────────────────────────────────────

router.get('/courses/:courseId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    const course = await Courses.findByPk(req.params.courseId);
    if (!course || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    res.render('editcourse', { user: req.user, course, csrfToken: req.csrfToken() });
});

router.post('/courses/:courseId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
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

router.post('/courses/:courseId/delete', ensureLoggedIn, requireEducator, async (req, res) => {
    const course = await Courses.findByPk(req.params.courseId);
    if (!course || course.creatorId !== req.user.id) {
        req.flash('error', 'Unauthorized');
        return res.redirect('/dashboard');
    }
    await course.destroy();
    req.flash('success', 'Course deleted!');
    res.redirect('/dashboard');
});

// ─── Chapters ────────────────────────────────────────────────────────────────

router.get('/addchapters', ensureLoggedIn, requireEducator, async (req, res) => {
    const myCourses = await getEducatorCourses(req.user.id);
    res.render('addchapters', { myCourses, user: req.user, csrfToken: req.csrfToken() });
});

router.post('/addchapters', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const course = await Courses.findOne({ where: { name: req.body.courseName } });
        if (!course) throw new Error('Course not found');
        await Chapters.create({
            name: req.body.chapterName,
            description: req.body.description,
            courseId: course.id,
        });
        req.flash('success', 'Chapter created successfully.');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', 'Chapter creation failed.');
        res.redirect('/addchapters');
    }
});

router.get('/chapters/:chapterId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { chapter } = await loadChapterForEducator(req.params.chapterId, req.user.id);
        res.render('editchapter', { user: req.user, chapter, csrfToken: req.csrfToken() });
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

router.post('/chapters/:chapterId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { chapter, course } = await loadChapterForEducator(req.params.chapterId, req.user.id);
        chapter.name = req.body.name;
        chapter.description = req.body.description;
        await chapter.save();
        req.flash('success', 'Chapter updated!');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

router.post('/chapters/:chapterId/delete', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { chapter, course } = await loadChapterForEducator(req.params.chapterId, req.user.id);
        await chapter.destroy();
        req.flash('success', 'Chapter deleted!');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

// ─── Pages ───────────────────────────────────────────────────────────────────

router.get('/addpages', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const courseId = req.query.courseId;
        const myChapters = await Chapters.findAll({
            where: { courseId },
            include: [{ model: Pages }],
        });
        res.render('addpages', {
            user: req.user,
            csrfToken: req.csrfToken(),
            myChapters,
            courseId,
        });
    } catch (error) {
        req.flash('error', 'Missing or invalid course.');
        res.redirect('/dashboard');
    }
});

router.post('/addpages', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { courseId, chapterId, title, content } = req.body;
        if (!courseId || !chapterId || !title || !content) {
            throw new Error('Missing required fields');
        }
        await Pages.create({ title, content, chapterId });
        req.flash('success', 'Page created successfully.');
        return res.redirect(`/courses/${courseId}`);
    } catch (error) {
        req.flash('error', 'Page creation failed.');
        return res.redirect(`/addpages?courseId=${req.body.courseId || ''}`);
    }
});

router.get('/pages/:pageId', ensureLoggedIn, async (req, res) => {
    try {
        const page = await Pages.findByPk(req.params.pageId, {
            include: [{ model: Chapters }],
        });
        if (!page) {
            req.flash('error', 'Page not found');
            return res.redirect('back');
        }
        const chapter = page.Chapter;
        const course = await Courses.findByPk(chapter.courseId);

        let allowed = false;
        if (req.user.role === 'educator' && course.creatorId === req.user.id) {
            allowed = true;
        } else if (req.user.role === 'student') {
            const enrollment = await Enrollments.findOne({
                where: { userId: req.user.id, courseId: course.id },
            });
            allowed = !!enrollment;
        }
        if (!allowed) {
            req.flash('error', 'You are not authorized to view this page.');
            return res.redirect('/dashboard');
        }

        const chapterPages = await Pages.findAll({
            where: { chapterId: chapter.id },
            order: [['id', 'ASC']],
        });
        const pageIndex = chapterPages.findIndex((p) => p.id === page.id);
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
            isCompleted: !!(await Completions.findOne({
                where: { userId: req.user.id, pageId: page.id },
            })),
        });
    } catch (error) {
        req.flash('error', 'Could not load page.');
        res.redirect('back');
    }
});

router.post('/pages/:pageId/complete', ensureLoggedIn, async (req, res) => {
    try {
        const { pageId } = req.params;
        await Completions.findOrCreate({ where: { userId: req.user.id, pageId } });
        req.flash('success', 'Page marked as complete!');
        res.redirect(`/pages/${pageId}`);
    } catch (error) {
        req.flash('error', 'Could not mark as complete.');
        res.redirect(`/pages/${req.params.pageId}`);
    }
});

router.get('/pages/:pageId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { page, chapter } = await loadPageForEducator(req.params.pageId, req.user.id);
        res.render('editpage', { user: req.user, page, chapter, csrfToken: req.csrfToken() });
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

router.post('/pages/:pageId/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { page, course } = await loadPageForEducator(req.params.pageId, req.user.id);
        page.title = req.body.title;
        page.content = req.body.content;
        await page.save();
        req.flash('success', 'Page updated!');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

router.post('/pages/:pageId/delete', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const { page, course } = await loadPageForEducator(req.params.pageId, req.user.id);
        await page.destroy();
        req.flash('success', 'Page deleted!');
        res.redirect(`/courses/${course.id}`);
    } catch (error) {
        req.flash('error', error.message || 'Unauthorized');
        res.redirect('/dashboard');
    }
});

// ─── Enrollment ───────────────────────────────────────────────────────────────

router.post('/enroll/:courseId', ensureLoggedIn, async (req, res) => {
    try {
        const [, created] = await Enrollments.findOrCreate({
            where: { userId: req.user.id, courseId: req.params.courseId },
        });
        req.flash(created ? 'success' : 'info', created ? 'Enrolled successfully!' : 'You are already enrolled in this course.');
        res.redirect('/dashboard');
    } catch (error) {
        req.flash('error', 'Could not enroll in course.');
        res.redirect('/dashboard');
    }
});

// ─── Quiz ─────────────────────────────────────────────────────────────────────

router.get('/chapters/:chapterId/quiz/add', ensureLoggedIn, requireEducator, (req, res) => {
    res.render('addquizquestion', {
        chapterId: req.params.chapterId,
        csrfToken: req.csrfToken(),
        user: req.user,
    });
});

router.post('/chapters/:chapterId/quiz/add', ensureLoggedIn, requireEducator, async (req, res) => {
    await QuizQuestion.create({
        chapterId: req.params.chapterId,
        question: req.body.question,
        answer: req.body.answer,
    });
    req.flash('success', 'Quiz question added!');
    res.redirect(`/chapters/${req.params.chapterId}/quiz/edit`);
});

router.post('/quizquestion/:id/delete', ensureLoggedIn, requireEducator, async (req, res) => {
    const qq = await QuizQuestion.findByPk(req.params.id);
    if (qq) {
        const chapterId = qq.chapterId;
        await qq.destroy();
        req.flash('success', 'Quiz question deleted!');
        return res.redirect(`/chapters/${chapterId}/quiz/edit`);
    }
    req.flash('error', 'Question not found.');
    res.redirect('/dashboard');
});

router.get('/chapters/:chapterId/quiz', ensureLoggedIn, async (req, res) => {
    try {
        const chapterId = req.params.chapterId;
        const chapter = await Chapters.findByPk(chapterId);
        if (!chapter) {
            req.flash('error', 'Chapter not found.');
            return res.redirect('/dashboard');
        }
        const courseId = chapter.courseId;
        const questions = await QuizQuestion.findAll({ where: { chapterId } });
        if (!questions.length) {
            req.flash('info', 'No quiz for this chapter.');
            return res.redirect(`/courses/${courseId}`);
        }

        const attempt = await QuizAttempt.findOne({ where: { userId: req.user.id, chapterId } });
        let showAnswers = false;
        let passed = false;
        if (attempt) {
            passed = attempt.score !== null && attempt.score === attempt.total;
            showAnswers = attempt.attempts >= 3 || passed;
        }

        res.render('quiz', {
            questions,
            chapterId,
            courseId,
            csrfToken: req.csrfToken(),
            user: req.user,
            attempt,
            showAnswers,
            passed,
        });
    } catch (error) {
        req.flash('error', 'Could not load quiz.');
        res.redirect('/dashboard');
    }
});

router.post('/chapters/:chapterId/quiz', ensureLoggedIn, async (req, res) => {
    try {
        const chapterId = req.params.chapterId;
        const userId = req.user.id;
        const questions = await QuizQuestion.findAll({ where: { chapterId } });

        let [attempt] = await QuizAttempt.findOrCreate({
            where: { userId, chapterId },
            defaults: { score: 0, total: questions.length, attempts: 0 },
        });

        if (attempt.attempts >= 3 || attempt.score === attempt.total) {
            req.flash('error', 'No more attempts allowed. Correct answers are now shown.');
            return res.redirect(`/chapters/${chapterId}/quiz`);
        }

        let score = 0;
        const wrongAnswers = [];
        questions.forEach((q) => {
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
            const answerList = wrongAnswers
                .map((w) => `<li><strong>${w.question}</strong>: ${w.correct}</li>`)
                .join('');
            req.flash('error', `You have reached 3 attempts. Correct answers:<ul>${answerList}</ul>`);
        } else {
            req.flash(
                'error',
                `Quiz submitted! Your score: ${score}/${questions.length}. You have ${3 - attempt.attempts} attempt(s) left.`
            );
        }

        res.redirect(`/chapters/${chapterId}/quiz`);
    } catch (error) {
        req.flash('error', 'Could not submit quiz.');
        res.redirect('/dashboard');
    }
});

router.get('/chapters/:chapterId/quiz/edit', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const chapterId = req.params.chapterId;
        const chapter = await Chapters.findByPk(chapterId);
        if (!chapter) {
            req.flash('error', 'Chapter not found.');
            return res.redirect('/dashboard');
        }
        const questions = await QuizQuestion.findAll({ where: { chapterId } });
        res.render('editquiz', {
            questions,
            chapterId,
            courseId: chapter.courseId,
            csrfToken: req.csrfToken(),
            user: req.user,
        });
    } catch (error) {
        req.flash('error', 'Could not load quiz editor.');
        res.redirect('/dashboard');
    }
});

// ─── Reports ─────────────────────────────────────────────────────────────────

router.get('/reports', ensureLoggedIn, requireEducator, async (req, res) => {
    try {
        const courses = await Courses.findAll({ where: { creatorId: req.user.id } });
        const reports = await Promise.all(
            courses.map(async (course) => {
                const count = await Enrollments.count({ where: { courseId: course.id } });
                return { course, count };
            })
        );
        res.render('reports', { user: req.user, reports, csrfToken: req.csrfToken() });
    } catch (error) {
        req.flash('error', 'Could not load reports.');
        res.redirect('/dashboard');
    }
});

module.exports = router;
