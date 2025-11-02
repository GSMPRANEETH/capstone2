// Helper functions for common database queries

const { Op } = require('sequelize');
const { Courses, Chapters, Pages, Enrollments, Completions, QuizQuestion, QuizAttempt } = require("../models");

/**
 * Get all courses created by a user (educator)
 * @param {number} userId - The user's ID
 * @returns {Promise<Array>} - Array of courses
 */
async function getCoursesByCreator(userId) {
    return await Courses.findAll({ where: { creatorId: userId } });
}

/**
 * Get all chapters for a course
 * @param {number} courseId - The course ID
 * @param {boolean} includePages - Whether to include pages
 * @returns {Promise<Array>} - Array of chapters
 */
async function getChaptersByCourse(courseId, includePages = false) {
    const options = { where: { courseId } };
    if (includePages) {
        options.include = [{ model: Pages }];
    }
    return await Chapters.findAll(options);
}

/**
 * Get enrolled courses for a user (student)
 * @param {number} userId - The user's ID
 * @returns {Promise<Array>} - Array of courses
 */
async function getEnrolledCourses(userId) {
    const enrolledRows = await Enrollments.findAll({
        where: { userId },
        attributes: ['courseId']
    });
    const enrolledCourseIds = enrolledRows.map(row => row.courseId);
    return await Courses.findAll({ where: { id: enrolledCourseIds } });
}

/**
 * Get available courses (not enrolled) for a user
 * @param {number} userId - The user's ID
 * @returns {Promise<Array>} - Array of courses
 */
async function getAvailableCourses(userId) {
    const enrolledRows = await Enrollments.findAll({
        where: { userId },
        attributes: ['courseId']
    });
    const enrolledCourseIds = enrolledRows.map(row => row.courseId);
    return await Courses.findAll({
        where: { id: { [Op.notIn]: enrolledCourseIds } }
    });
}

/**
 * Check if user is enrolled in a course
 * @param {number} userId - The user's ID
 * @param {number} courseId - The course ID
 * @returns {Promise<boolean>} - True if enrolled
 */
async function isUserEnrolled(userId, courseId) {
    const enrollment = await Enrollments.findOne({
        where: { userId, courseId }
    });
    return !!enrollment;
}

/**
 * Check if user is the course creator
 * @param {number} userId - The user's ID
 * @param {number} courseId - The course ID
 * @returns {Promise<boolean>} - True if user created the course
 */
async function isCourseCreator(userId, courseId) {
    const course = await Courses.findByPk(courseId);
    return course && course.creatorId === userId;
}

module.exports = {
    getCoursesByCreator,
    getChaptersByCourse,
    getEnrolledCourses,
    getAvailableCourses,
    isUserEnrolled,
    isCourseCreator
};
