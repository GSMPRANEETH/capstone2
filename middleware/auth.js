// Authentication and authorization middleware

const connectEnsureLogin = require("connect-ensure-login");

// Middleware to ensure user is logged in
const ensureLoggedIn = connectEnsureLogin.ensureLoggedIn("/signin");

// Middleware to restrict educator-only access
function requireEducator(req, res, next) {
    if (req.user && req.user.role === 'educator') {
        return next();
    }
    return res.status(401).json({ message: 'Unauthorized. Educator access required.' });
}

// Middleware to restrict student-only access
function requireStudent(req, res, next) {
    if (req.user && req.user.role === 'student') {
        return next();
    }
    return res.status(401).json({ message: 'Unauthorized. Student access required.' });
}

// Middleware to check if user is enrolled in a course
async function requireEnrollment(models) {
    return async (req, res, next) => {
        try {
            const courseId = req.params.courseId || req.body.courseId || req.query.courseId;
            if (!courseId) {
                req.flash('error', 'Course ID is required.');
                return res.redirect('/dashboard');
            }

            const enrollment = await models.Enrollments.findOne({
                where: { userId: req.user.id, courseId }
            });

            if (!enrollment) {
                req.flash('error', 'You must be enrolled in this course.');
                return res.redirect('/dashboard');
            }

            req.enrollment = enrollment;
            next();
        } catch (error) {
            req.flash('error', 'Error checking enrollment.');
            res.redirect('/dashboard');
        }
    };
}

// Middleware to check if user is the course creator
async function requireCourseOwnership(models) {
    return async (req, res, next) => {
        try {
            const courseId = req.params.courseId || req.body.courseId || req.query.courseId;
            if (!courseId) {
                req.flash('error', 'Course ID is required.');
                return res.redirect('/dashboard');
            }

            const course = await models.Courses.findByPk(courseId);
            if (!course) {
                req.flash('error', 'Course not found.');
                return res.redirect('/dashboard');
            }

            if (course.creatorId !== req.user.id) {
                req.flash('error', 'Unauthorized. You are not the course creator.');
                return res.redirect('/dashboard');
            }

            req.course = course;
            next();
        } catch (error) {
            req.flash('error', 'Error checking course ownership.');
            res.redirect('/dashboard');
        }
    };
}

module.exports = {
    ensureLoggedIn,
    requireEducator,
    requireStudent,
    requireEnrollment,
    requireCourseOwnership
};
